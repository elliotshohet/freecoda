import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool, transaction } from "../db";
import { ApiError } from "../http";
import { encrypt, decrypt } from "./crypto";
import type {
  CloudProject,
  ProjectPayload,
  CloudRun,
  RunPayload,
  CloudEvent,
} from "./types";
export const CLOUD_STORAGE_CAP_BYTES = 350_000_000;
async function storageLock(db: PoolClient) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('cloud-storage'))");
}
async function requireStorage(db: PoolClient, delta: number) {
  if (delta <= 0) return;
  const row = (
    await db.query(
      "SELECT (coalesce((SELECT sum(octet_length(payload)) FROM cloud_projects),0)+coalesce((SELECT sum(octet_length(payload)) FROM cloud_runs),0)+coalesce((SELECT sum(octet_length(payload)) FROM cloud_events),0)) AS bytes",
    )
  ).rows[0];
  if (Number(row.bytes) + delta > CLOUD_STORAGE_CAP_BYTES)
    throw new ApiError(
      429,
      "Free cloud storage is at capacity. Delete an unused project or try after retained data expires.",
    );
}
const projectColumns =
  'id,user_id AS "userId",name,status,sandbox_id AS "sandboxId",snapshot_id AS "snapshotId",app_directory AS "appDirectory",created_at AS "createdAt",updated_at AS "updatedAt",expires_at AS "expiresAt",payload,version';
const runColumns =
  'id,project_id AS "projectId",user_id AS "userId",status,workflow_id AS "workflowId",created_at AS "createdAt",updated_at AS "updatedAt"';
export async function project(userId: string, id: string) {
  const { rows } = await getPool().query(
    `SELECT ${projectColumns} FROM cloud_projects WHERE id=$1 AND user_id=$2 AND status<>'deleted' AND expires_at>now()`,
    [id, userId],
  );
  if (!rows[0])
    throw new ApiError(404, "Project was not found or has expired.");
  const { payload, version, ...data } = rows[0];
  const body = decrypt<ProjectPayload>(payload, `project:${id}`);
  return {
    project: {
      ...data,
      error: body.error,
      repo: body.repository
        ? (({ baseFiles, ...repo }) => repo)(body.repository)
        : undefined,
    } as CloudProject,
    payload: body,
    version: Number(version),
  };
}
export async function listProjects(userId: string) {
  const { rows } = await getPool().query(
    `SELECT ${projectColumns} FROM cloud_projects WHERE user_id=$1 AND status<>'deleted' AND expires_at>now() ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((row) => {
    const { payload, version, ...data } = row;
    const body = decrypt<ProjectPayload>(payload, `project:${row.id}`);
    return {
      ...data,
      error: body.error,
      repo: body.repository
        ? (({ baseFiles, ...repo }) => repo)(body.repository)
        : undefined,
    } as CloudProject;
  });
}
export async function createProject(
  userId: string,
  name: string,
  payload: ProjectPayload,
) {
  const id = randomUUID();
  const encrypted = encrypt(payload, `project:${id}`);
  await transaction(async (db) => {
    await storageLock(db);
    await requireStorage(db, Buffer.byteLength(encrypted));
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `cloud-projects:${userId}`,
    ]);
    const count = await db.query(
      "SELECT count(*) FROM cloud_projects WHERE user_id=$1 AND status<>'deleted' AND expires_at>now()",
      [userId],
    );
    if (Number(count.rows[0].count) >= 3)
      throw new ApiError(429, "The beta permits three projects per account.");
    await db.query(
      "INSERT INTO cloud_projects(id,user_id,name,status,payload) VALUES($1,$2,$3,'suspended',$4)",
      [id, userId, name, encrypted],
    );
  });
  return (await project(userId, id)).project;
}
export async function saveProject(
  userId: string,
  id: string,
  version: number,
  payload: ProjectPayload,
  patch: Partial<
    Pick<CloudProject, "status" | "sandboxId" | "snapshotId" | "appDirectory">
  > = {},
) {
  const data = await project(userId, id);
  const next = { ...data.project, ...patch };
  const encrypted = encrypt(payload, `project:${id}`);
  await transaction(async (db) => {
    await storageLock(db);
    const old = (
      await db.query(
        "SELECT octet_length(payload) AS bytes FROM cloud_projects WHERE id=$1 AND user_id=$2 AND version=$3 AND status<>'deleted' AND expires_at>now() FOR UPDATE",
        [id, userId, version],
      )
    ).rows[0];
    if (!old)
      throw new ApiError(
        409,
        "Project changed concurrently. Refresh before continuing.",
      );
    await requireStorage(db, Buffer.byteLength(encrypted) - Number(old.bytes));
    const result = await db.query(
      `UPDATE cloud_projects SET payload=$1,status=$2,sandbox_id=$3,snapshot_id=$4,app_directory=$5,version=version+1,updated_at=now(),expires_at=now()+interval \'7 days\' WHERE id=$6 AND user_id=$7 AND version=$8 AND status<>'deleted' AND expires_at>now() RETURNING id`,
      [
        encrypted,
        next.status,
        next.sandboxId,
        next.snapshotId,
        next.appDirectory,
        id,
        userId,
        version,
      ],
    );
    if (!result.rowCount)
      throw new ApiError(
        409,
        "Project changed concurrently. Refresh before continuing.",
      );
  });
  return (await project(userId, id)).project;
}
export async function runs(projectId: string) {
  const { rows } = await getPool().query(
    `SELECT ${runColumns} FROM cloud_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [projectId],
  );
  return rows as CloudRun[];
}
export async function run(userId: string, id: string) {
  const { rows } = await getPool().query(
    `SELECT ${runColumns},payload FROM cloud_runs WHERE id=$1 AND user_id=$2`,
    [id, userId],
  );
  if (!rows[0]) throw new ApiError(404, "Run not found.");
  const { payload, ...data } = rows[0];
  await project(userId, data.projectId);
  return {
    run: data as CloudRun,
    payload: decrypt<RunPayload>(payload, `run:${id}`),
  };
}
export async function createRun(
  userId: string,
  projectId: string,
  payload: RunPayload,
) {
  const id = randomUUID();
  try {
    await transaction(async (db) => {
      await storageLock(db);
      const projectRow = (
        await db.query(
          "SELECT operation_token,operation_expires_at FROM cloud_projects WHERE id=$1 AND user_id=$2 AND expires_at>now() AND status<>'deleted' FOR UPDATE",
          [projectId, userId],
        )
      ).rows[0];
      if (!projectRow) throw new ApiError(404, "Project not found.");
      if (
        projectRow.operation_token &&
        new Date(projectRow.operation_expires_at).getTime() > Date.now()
      )
        throw new ApiError(409, "Another project operation is in progress.");
      const previous = (
        await db.query(
          "SELECT payload,id FROM cloud_runs WHERE project_id=$1 AND user_id=$2 AND status='completed' ORDER BY created_at DESC LIMIT 1",
          [projectId, userId],
        )
      ).rows[0];
      let messages = previous
        ? decrypt<RunPayload>(previous.payload, `run:${previous.id}`)
            .messages || []
        : [];
      while (
        messages.length &&
        Buffer.byteLength(JSON.stringify(messages)) > 40000
      ) {
        const next = messages.findIndex(
          (message, index) => index > 0 && message.role === "user",
        );
        messages = next > 0 ? messages.slice(next) : [];
      }
      payload = {
        ...payload,
        messages: [...messages, { role: "user", content: payload.prompt }],
      };
      const encrypted = encrypt(payload, `run:${id}`);
      await requireStorage(db, Buffer.byteLength(encrypted));
      await db.query(
        "INSERT INTO cloud_runs(id,user_id,project_id,status,payload) VALUES($1,$2,$3,'queued',$4)",
        [id, userId, projectId, encrypted],
      );
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      throw new ApiError(409, "Another agent run is active.");
    throw e;
  }
  return (await run(userId, id)).run;
}
export async function runState(
  id: string,
  status: CloudRun["status"],
  workflowId?: string,
) {
  await getPool().query(
    "UPDATE cloud_runs SET status=CASE WHEN status IN ('cancelled','completed','failed') THEN status WHEN $3::text IS NOT NULL AND $2::text='queued' THEN status ELSE $2 END,workflow_id=coalesce($3::text,workflow_id),updated_at=now() WHERE id=$1",
    [id, status, workflowId],
  );
}
export async function event(runId: string, type: string, data: unknown) {
  const id = randomUUID();
  const encrypted = encrypt({ id, data }, `event:${runId}`);
  await transaction(async (db) => {
    await storageLock(db);
    await requireStorage(db, Buffer.byteLength(encrypted));
    await db.query(
      "INSERT INTO cloud_events(run_id,type,payload) VALUES($1,$2,$3)",
      [runId, type, encrypted],
    );
  });
}
export async function events(userId: string, runId: string, after: number) {
  const r = await run(userId, runId);
  const { rows } = await getPool().query(
    'SELECT id,type,payload,created_at AS "createdAt" FROM cloud_events WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 100',
    [runId, after],
  );
  return {
    run: r.run,
    events: rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      data: decrypt<{ data: unknown }>(row.payload, `event:${runId}`).data,
      createdAt: row.createdAt,
    })) as CloudEvent[],
  };
}
export async function reserveCompute(userId: string, projectId: string) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('cloud-compute'))");
    const authorized = await db.query(
      "SELECT p.id FROM cloud_projects p WHERE p.id=$1 AND p.user_id=$2 AND p.status<>'deleted' AND p.expires_at>now() AND NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=$2 AND suspended=true) FOR UPDATE",
      [projectId, userId],
    );
    if (!authorized.rowCount) throw new ApiError(404, "Project not found.");
    const expired = (
      await db.query(
        "UPDATE cloud_compute_reservations SET status='settled',actual_seconds=seconds,settled_at=now(),settlement_reason='hard_timeout' WHERE status='active' AND created_at<now()-interval '20 minutes' RETURNING *",
      )
    ).rows;
    for (const r of expired)
      await db.query(
        "UPDATE cloud_compute_buckets SET reserved_seconds=greatest(0,reserved_seconds-$4),spent_seconds=spent_seconds+$4 WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
        [r.user_id, r.day, r.month, r.seconds],
      );
    const active = await db.query(
      "SELECT user_id FROM cloud_compute_reservations WHERE status='active'",
    );
    if (
      active.rows.some((row) => row.user_id === userId) ||
      active.rowCount! >= 2
    )
      throw new ApiError(
        429,
        "Cloud compute is busy. Suspend the active workspace or try later.",
      );
    const day = new Date().toISOString().slice(0, 10),
      month = day.slice(0, 7);
    const seconds = 900;
    await db.query(
      "INSERT INTO cloud_compute_buckets(scope,period) VALUES($1,$2),('global',$3) ON CONFLICT DO NOTHING",
      [userId, day, month],
    );
    const rows = (
      await db.query(
        "SELECT * FROM cloud_compute_buckets WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3) FOR UPDATE",
        [userId, day, month],
      )
    ).rows;
    for (const row of rows) {
      const cap = row.scope === "global" ? 9000 : 1800;
      if (
        Number(row.spent_seconds) + Number(row.reserved_seconds) + seconds >
        cap
      )
        throw new ApiError(429, "Cloud compute allowance is exhausted.");
    }
    const id = randomUUID();
    await db.query(
      "INSERT INTO cloud_compute_reservations(id,user_id,project_id,day,month,seconds,status) VALUES($1,$2,$3,$4,$5,$6,'active')",
      [id, userId, projectId, day, month, seconds],
    );
    await db.query(
      "UPDATE cloud_compute_buckets SET reserved_seconds=reserved_seconds+$4 WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
      [userId, day, month, seconds],
    );
    return id;
  });
}
export async function settleCompute(id: string) {
  await transaction(async (db) => {
    const r = (
      await db.query(
        "UPDATE cloud_compute_reservations SET status='settled',actual_seconds=least(seconds,greatest(0,ceil(extract(epoch FROM (now()-created_at)))))::integer,settled_at=now(),settlement_reason='confirmed_stop' WHERE id=$1 AND status='active' RETURNING *",
        [id],
      )
    ).rows[0];
    if (!r) return;
    await db.query(
      "UPDATE cloud_compute_buckets SET reserved_seconds=greatest(0,reserved_seconds-$4),spent_seconds=spent_seconds+$5 WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
      [r.user_id, r.day, r.month, r.seconds, r.actual_seconds],
    );
  });
}

export async function checkpointRun(
  userId: string,
  id: string,
  payload: RunPayload,
) {
  const encrypted = encrypt(payload, `run:${id}`);
  await transaction(async (db) => {
    await storageLock(db);
    const row = (
      await db.query(
        "SELECT octet_length(payload) AS bytes FROM cloud_runs WHERE id=$1 AND user_id=$2 AND status='running' FOR UPDATE",
        [id, userId],
      )
    ).rows[0];
    if (!row) return;
    await requireStorage(db, Buffer.byteLength(encrypted) - Number(row.bytes));
    await db.query(
      "UPDATE cloud_runs SET payload=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='running'",
      [id, userId, encrypted],
    );
  });
}

export async function withProjectOperation<T>(
  userId: string,
  id: string,
  fn: () => Promise<T>,
): Promise<T> {
  const token = randomUUID();
  const result = await getPool().query(
    "UPDATE cloud_projects SET operation_token=$3,operation_expires_at=now()+interval '5 minutes' WHERE id=$1 AND user_id=$2 AND status<>'deleted' AND expires_at>now() AND (operation_token IS NULL OR operation_expires_at<now()) AND NOT EXISTS(SELECT 1 FROM cloud_runs WHERE project_id=$1 AND status IN('queued','running')) RETURNING id",
    [id, userId, token],
  );
  if (!result.rowCount)
    throw new ApiError(
      409,
      "Another project operation or agent run is in progress.",
    );
  try {
    return await fn();
  } finally {
    await getPool().query(
      "UPDATE cloud_projects SET operation_token=NULL,operation_expires_at=NULL WHERE id=$1 AND operation_token=$2",
      [id, token],
    );
  }
}

export async function releaseCompute(id: string) {
  await transaction(async (db) => {
    const row = (
      await db.query(
        "UPDATE cloud_compute_reservations SET status='settled',actual_seconds=0,settled_at=now(),settlement_reason='no_resource_created' WHERE id=$1 AND status='active' RETURNING *",
        [id],
      )
    ).rows[0];
    if (row)
      await db.query(
        "UPDATE cloud_compute_buckets SET reserved_seconds=greatest(0,reserved_seconds-$4) WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
        [row.user_id, row.day, row.month, row.seconds],
      );
  });
}
