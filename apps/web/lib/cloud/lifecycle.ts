import { sleep } from "workflow";

// Replacing a sleeping watcher on explicit activity avoids duplicate timers
// without polling suspended projects for seven days.
export async function scheduleProjectLifecycle(projectId: string) {
  const { transaction } = await import("../db");
  const { start, getRun } = await import("workflow/api");
  await transaction(async (db) => {
    const row = (
      await db.query(
        "SELECT lifecycle_workflow_id FROM cloud_projects WHERE id=$1 FOR UPDATE",
        [projectId],
      )
    ).rows[0];
    if (!row) return;
    if (row.lifecycle_workflow_id)
      await getRun(row.lifecycle_workflow_id)
        .cancel()
        .catch(() => {});
    const run = await start(cloudProjectLifecycle, [projectId]);
    await db.query(
      "UPDATE cloud_projects SET lifecycle_workflow_id=$2 WHERE id=$1",
      [projectId, run.runId],
    );
  });
}

async function maintainProject(projectId: string): Promise<number> {
  "use step";
  const { getPool } = await import("../db");
  const store = await import("./store");
  const vm = await import("./sandbox");
  const { suspend } = await import("./service");
  const pool = getPool();
  const client = await pool.connect();
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [`cloud-lifecycle:${projectId}`],
    );
    if (!lock.rows[0].acquired) return 60_000;
    try {
      const row = (
        await client.query("SELECT * FROM cloud_projects WHERE id=$1", [
          projectId,
        ])
      ).rows[0];
      if (!row) return 0;
      const expired = new Date(row.expires_at).getTime() <= Date.now();
      if (!expired && row.status !== "deleted" && row.sandbox_id) {
        const { requireInvite } = await import("../security");
        let allowed = true;
        try {
          await requireInvite(row.user_id);
        } catch {
          allowed = false;
        }
        if (!allowed) {
          await client.query(
            "UPDATE cloud_runs SET status='cancelled' WHERE project_id=$1 AND status IN ('queued','running')",
            [projectId],
          );
          await vm.stopProjectSandbox({
            id: projectId,
            sandboxId: row.sandbox_id,
          });
          const leases = await client.query(
            "SELECT id FROM cloud_compute_reservations WHERE project_id=$1 AND status='active'",
            [projectId],
          );
          for (const lease of leases.rows) await store.settleCompute(lease.id);
          await client.query(
            "UPDATE cloud_projects SET status='suspended',sandbox_id=NULL WHERE id=$1",
            [projectId],
          );
          return 60_000;
        }
      }
      if (expired || row.status === "deleted") {
        // Access disappears before external cleanup; failures retain identifiers for retry.
        await client.query(
          "UPDATE cloud_projects SET status='deleted' WHERE id=$1",
          [projectId],
        );
        await client.query(
          "UPDATE cloud_runs SET status='cancelled' WHERE project_id=$1 AND status IN ('queued','running')",
          [projectId],
        );
        if (row.sandbox_id)
          await vm.stopProjectSandbox({
            id: projectId,
            sandboxId: row.sandbox_id,
          });
        if (row.snapshot_id) await vm.deleteProjectSnapshot(row.snapshot_id);
        const leases = await client.query(
          "SELECT id FROM cloud_compute_reservations WHERE project_id=$1 AND status='active'",
          [projectId],
        );
        for (const lease of leases.rows) await store.settleCompute(lease.id);
        await client.query("DELETE FROM cloud_projects WHERE id=$1", [
          projectId,
        ]);
        return 0;
      }
      if (row.sandbox_id) {
        const running = await client.query(
          "SELECT 1 FROM cloud_runs WHERE project_id=$1 AND status IN ('queued','running')",
          [projectId],
        );
        const lease = (
          await client.query(
            "SELECT created_at FROM cloud_compute_reservations WHERE project_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",
            [projectId],
          )
        ).rows[0];
        const deadline = lease
          ? new Date(lease.created_at).getTime() + 15 * 60_000
          : Date.now();
        const idle =
          Date.now() - new Date(row.updated_at).getTime() >= 5 * 60_000;
        if (Date.now() >= deadline - 90_000 || (idle && !running.rowCount)) {
          await client.query(
            "UPDATE cloud_runs SET status='cancelled' WHERE project_id=$1 AND status IN ('queued','running')",
            [projectId],
          );
          await suspend(row.user_id, projectId);
          // Automatic maintenance is not new user activity.
          await client.query(
            "UPDATE cloud_projects SET expires_at=$2 WHERE id=$1",
            [projectId, row.expires_at],
          );
        }
        return 60_000;
      }
      return Math.max(1_000, new Date(row.expires_at).getTime() - Date.now());
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `cloud-lifecycle:${projectId}`,
      ]);
    }
  } catch {
    // Keep scheduling cleanup even through a prolonged provider outage.
    // Deleted projects remain inaccessible while external resources retry.
    return 60_000;
  } finally {
    client.release();
  }
}
maintainProject.maxRetries = 20;

export async function cloudProjectLifecycle(projectId: string) {
  "use workflow";
  for (;;) {
    const wait = await maintainProject(projectId);
    if (!wait) return;
    await sleep(wait);
  }
}

export async function deleteCloudProject(userId: string, projectId: string) {
  const { getPool } = await import("../db");
  const pool = getPool();
  await pool.query(
    "UPDATE cloud_projects SET status='deleted' WHERE id=$1 AND user_id=$2",
    [projectId, userId],
  );
  await pool.query(
    "UPDATE cloud_runs SET status='cancelled' WHERE project_id=$1 AND user_id=$2 AND status IN ('queued','running')",
    [projectId, userId],
  );
  const row = (
    await pool.query(
      "SELECT sandbox_id FROM cloud_projects WHERE id=$1 AND user_id=$2",
      [projectId, userId],
    )
  ).rows[0];
  if (row?.sandbox_id) {
    const { stopProjectSandbox } = await import("./sandbox");
    try {
      await stopProjectSandbox({ id: projectId, sandboxId: row.sandbox_id });
    } catch {
      /* The durable cleanup below retries while project access is revoked. */
    }
  }
  await scheduleProjectLifecycle(projectId);
}

async function cleanAccountResources(jobId: string): Promise<boolean> {
  "use step";
  const { getPool } = await import("../db");
  const vm = await import("./sandbox");
  const pool = getPool();
  const row = (
    await pool.query(
      "SELECT sandbox_ids,snapshot_ids FROM cloud_resource_cleanup WHERE id=$1",
      [jobId],
    )
  ).rows[0];
  if (!row) return true;
  try {
    for (const name of row.sandbox_ids as string[])
      await vm.stopProjectSandbox({ id: jobId, sandboxId: name });
    for (const id of row.snapshot_ids as string[])
      await vm.deleteProjectSnapshot(id);
    await pool.query("DELETE FROM cloud_resource_cleanup WHERE id=$1", [jobId]);
    return true;
  } catch {
    return false;
  }
}

export async function cloudAccountCleanup(jobId: string) {
  "use workflow";
  while (!(await cleanAccountResources(jobId))) await sleep("1m");
}

export async function prepareAccountDeletion(userId: string) {
  const { randomUUID } = await import("node:crypto");
  const { transaction } = await import("../db");
  const jobId = randomUUID();
  await transaction(async (db) => {
    // Use the same lock order as admission so a concurrent resume cannot
    // create a new lease after the cleanup handles and spending are captured.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('cloud-compute'))");
    // Block new admissions while external cleanup runs before user cascade.
    await db.query(
      "INSERT INTO profiles(user_id,suspended) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET suspended=true",
      [userId],
    );
    const rows = (
      await db.query(
        "SELECT sandbox_id,snapshot_id FROM cloud_projects WHERE user_id=$1 FOR UPDATE",
        [userId],
      )
    ).rows;
    await db.query(
      "UPDATE cloud_projects SET status='deleted' WHERE user_id=$1",
      [userId],
    );
    await db.query(
      "UPDATE cloud_runs SET status='cancelled' WHERE user_id=$1 AND status IN ('queued','running')",
      [userId],
    );
    // Account deletion cascades these leases. Move their entire reserved
    // amount into spending first, otherwise global capacity stays reserved
    // forever with no surviving lease to reconcile. Full charging is safe even
    // if an external stop fails and the VM runs until its hard timeout.
    const leases = (
      await db.query(
        "UPDATE cloud_compute_reservations SET status='settled',actual_seconds=seconds,settled_at=now(),settlement_reason='hard_timeout' WHERE user_id=$1 AND status='active' RETURNING *",
        [userId],
      )
    ).rows;
    for (const lease of leases)
      await db.query(
        "UPDATE cloud_compute_buckets SET reserved_seconds=greatest(0,reserved_seconds-$4),spent_seconds=spent_seconds+$4 WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
        [userId, lease.day, lease.month, lease.seconds],
      );
    await db.query(
      "INSERT INTO cloud_resource_cleanup(id,sandbox_ids,snapshot_ids) VALUES($1,$2,$3)",
      [
        jobId,
        JSON.stringify(rows.map((r) => r.sandbox_id).filter(Boolean)),
        JSON.stringify(rows.map((r) => r.snapshot_id).filter(Boolean)),
      ],
    );
  });
  // Try immediately; opaque resource handles survive the imminent account cascade.
  if (!(await cleanAccountResources(jobId))) {
    const { start } = await import("workflow/api");
    await start(cloudAccountCleanup, [jobId]);
  }
}
