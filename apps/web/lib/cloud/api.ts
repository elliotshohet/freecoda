import { z } from "zod";
import { start, getRun } from "workflow/api";
import { getPool } from "../db";
import { handle, json, jsonBody, ApiError, sameOrigin } from "../http";
import { identity, requireInvite, rateLimit } from "../security";
import { encryptionReady } from "./crypto";
import { githubReady, repositories } from "./github";
import * as store from "./store";
import * as service from "./service";
import * as vm from "./sandbox";
import { cloudAgentWorkflow, cloudImportWorkflow } from "./workflow";
import { scheduleProjectLifecycle, deleteCloudProject } from "./lifecycle";
const idSchema = z.uuid();
const identifier = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const consent = z.literal(true);
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    template: z.enum(["nextjs", "vite"]),
    consent,
  })
  .strict();
const importSchema = z
  .object({
    installationId: z.number().int().positive(),
    owner: identifier,
    repo: identifier,
    ref: z.string().min(1).max(200).optional(),
    consent,
  })
  .strict();
const filesSchema = z
  .object({
    path: z.string().min(1).max(500),
    content: z.string().max(1_000_000),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();
const runSchema = z
  .object({
    prompt: z.string().trim().min(1).max(20000),
    mode: z.enum(["build", "plan", "review"]).default("build"),
    consent,
  })
  .strict();
const publishSchema = z
  .object({
    expectedBaseSha: z.string().regex(/^[a-f0-9]{40}$/),
    reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().min(8).max(100),
    title: z.string().trim().min(1).max(150),
    body: z.string().max(10000),
    runId: z.uuid().optional(),
  })
  .strict();
async function lifecycle(id: string) {
  await scheduleProjectLifecycle(id);
}
const starter = [
  {
    path: "package.json",
    content:
      JSON.stringify(
        {
          name: "freecoda-project",
          private: true,
          scripts: {
            dev: "next dev --hostname 127.0.0.1 --port 3000",
            build: "next build",
            start: "next start --hostname 127.0.0.1 --port 3000",
          },
          dependencies: {
            next: "16.4.2",
            react: "19.3.1",
            "react-dom": "19.3.1",
          },
        },
        null,
        2,
      ) + "\n",
  },
  {
    path: "app/layout.jsx",
    content:
      'export default function Layout({children}) { return <html lang="en"><body style={{margin:0,fontFamily:"system-ui"}}>{children}</body></html> }\n',
  },
  {
    path: "app/page.jsx",
    content:
      'export default function Page(){return <main style={{padding:"12vh 8vw"}}><p>FREECODA PROJECT</p><h1>Your next big thing starts here.</h1><p>Describe what you want to build in your workspace.</p></main>}\n',
  },
  { path: ".gitignore", content: "node_modules/\n.next/\n.env*\n" },
];
const viteStarter = [
  {
    path: "package.json",
    content:
      JSON.stringify(
        {
          name: "freecoda-vite-project",
          private: true,
          type: "module",
          scripts: {
            dev: "vite --host 127.0.0.1 --port 3000",
            build: "vite build",
          },
          devDependencies: { vite: "^7.0.0" },
        },
        null,
        2,
      ) + "\n",
  },
  {
    path: "index.html",
    content:
      '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Freecoda project</title></head><body><main id="app"></main><script type="module" src="/src/main.js"></script></body></html>\n',
  },
  {
    path: "src/main.js",
    content:
      'document.querySelector("#app").innerHTML = "<h1>Your next big thing starts here.</h1><p>Build with Freecoda.</p>";\n',
  },
  { path: ".gitignore", content: "node_modules/\ndist/\n.env*\n" },
];
export async function cloudRoute(req: Request) {
  return handle(async () => {
    const path = new URL(req.url).pathname
      .replace(/^\/api\/web\/?/, "")
      .split("/")
      .filter(Boolean);
    const method = req.method;
    let user: Awaited<ReturnType<typeof identity>> | null = null;
    try {
      user = await identity(req);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    if (path[0] === "status" && method === "GET") {
      let invited = false;
      let reason = "Sign in to use cloud workspaces.";
      if (user && !user.device) {
        try {
          await requireInvite(user.id);
          invited = true;
          reason = "";
        } catch (error) {
          reason =
            error instanceof ApiError
              ? error.message
              : "Account authorization is unavailable.";
        }
      }
      const enabled = service.cloudEnabled();
      const ready = !!user && !user.device && invited && service.cloudReady();
      return json({
        enabled,
        authenticated: !!user && !user.device,
        invited,
        ready,
        reason: !enabled
          ? "Cloud workspaces are not enabled yet."
          : !encryptionReady()
            ? "Cloud workspace encryption is not configured."
            : reason,
        github: githubReady(),
        limits: {
          projects: 3,
          sourceBytes: 100_000_000,
          concurrentPerUser: 1,
          concurrentGlobal: 2,
          sessionSeconds: 900,
          dailyComputeSeconds: 1800,
          monthlyGlobalComputeSeconds: 9000,
          retentionDays: 7,
        },
      });
    }
    if (!user || user.device)
      throw new ApiError(401, "Sign in with GitHub in your browser.");
    await requireInvite(user.id);
    if (!service.cloudReady())
      throw new ApiError(
        503,
        "Cloud workspaces are not configured or enabled.",
      );
    if (method !== "GET") {
      sameOrigin(req);
      await rateLimit(`cloud:${user.id}`, 30, 60);
    }
    if (path.join("/") === "github/repos" && method === "GET")
      return json(await repositories(user.id));
    if (path[0] === "projects" && path.length === 1) {
      if (method === "GET")
        return json({ projects: await store.listProjects(user.id) });
      if (method === "POST") {
        const body = await jsonBody(req, createSchema);
        const project = await store.createProject(user.id, body.name, {
          files: body.template === "vite" ? viteStarter : starter,
          consentAt: new Date().toISOString(),
        });
        await lifecycle(project.id);
        return json({ project }, 201);
      }
    }
    if (path.join("/") === "projects/import" && method === "POST") {
      const body = await jsonBody(req, importSchema);
      const project = await store.createProject(user.id, body.repo, {
        files: [],
        repository: {
          installationId: body.installationId,
          owner: body.owner,
          name: body.repo,
          defaultBranch: body.ref || "",
          baseSha: "",
          repositoryId: 0,
          baseFiles: [],
        },
        consentAt: new Date().toISOString(),
      });
      const record = await store.project(user.id, project.id);
      await store.saveProject(
        user.id,
        project.id,
        record.version,
        record.payload,
        { status: "creating" },
      );
      try {
        await start(cloudImportWorkflow, [project.id]);
        await lifecycle(project.id);
      } catch (error) {
        const r = await store.project(user.id, project.id);
        await store.saveProject(user.id, project.id, r.version, r.payload, {
          status: "failed",
        });
        throw error;
      }
      return json(
        { project: (await store.project(user.id, project.id)).project },
        202,
      );
    }
    if (path[0] === "runs" && path[1]) {
      if (!idSchema.safeParse(path[1]).success)
        throw new ApiError(404, "Run not found.");
      const current = await store.run(user.id, path[1]);
      if (path[2] === "events" && method === "GET") {
        const after = Number(new URL(req.url).searchParams.get("after") || 0);
        if (!Number.isSafeInteger(after) || after < 0)
          throw new ApiError(400, "Invalid event cursor.");
        return json(await store.events(user.id, current.run.id, after));
      }
      if (path[2] === "cancel" && method === "POST") {
        await store.runState(current.run.id, "cancelled");
        if (current.run.workflowId)
          await getRun(current.run.workflowId)
            .cancel()
            .catch(() => {});
        const record = await store.project(user.id, current.run.projectId);
        if (record.project.sandboxId) {
          await vm.stopProjectCommands(record.project);
          const files = await vm.exportProjectSource(record.project);
          await store.saveProject(user.id, record.project.id, record.version, {
            ...record.payload,
            files,
          });
          await vm.stopProjectSandbox(record.project);
        }
        const savedRecord = await store.project(user.id, record.project.id);
        await store.saveProject(
          user.id,
          record.project.id,
          savedRecord.version,
          savedRecord.payload,
          { sandboxId: null, status: "suspended" },
        );
        const leases = await getPool().query(
          "SELECT id FROM cloud_compute_reservations WHERE project_id=$1 AND status='active'",
          [record.project.id],
        );
        for (const lease of leases.rows) await store.settleCompute(lease.id);
        await store.event(current.run.id, "status", {
          message: "Run cancelled. The isolated VM was stopped.",
        });
        return json({ run: (await store.run(user.id, current.run.id)).run });
      }
    }
    if (
      path[0] !== "projects" ||
      !path[1] ||
      !idSchema.safeParse(path[1]).success
    )
      throw new ApiError(404, "Cloud route not found.");
    const id = path[1];
    const record = await store.project(user.id, id);
    if (path.length === 2 && method === "GET")
      return json({
        project: record.project,
        files: await service.projectFiles(user.id, id),
        runs: await store.runs(id),
      });
    if (path.length === 2 && method === "PATCH") {
      const body = await jsonBody(
        req,
        z.object({ appDirectory: z.string().max(400) }).strict(),
      );
      return json({
        project: await service.selectAppDirectory(
          user.id,
          id,
          body.appDirectory,
        ),
      });
    }
    if (path.length === 2 && method === "DELETE") {
      await deleteCloudProject(user.id, id);
      return json({ deleted: true });
    }
    if (record.project.status === "creating")
      throw new ApiError(409, "Repository import is still running.");
    if (path[2] === "files") {
      if (method === "GET") {
        const path = new URL(req.url).searchParams.get("path");
        if (!path)
          return json({ files: await service.projectFiles(user.id, id) });
        await getPool().query(
          "UPDATE cloud_projects SET updated_at=now(),expires_at=now()+interval '7 days' WHERE id=$1",
          [id],
        );
        return json(await service.readFile(user.id, id, path));
      }
      if (method === "PUT")
        return json(
          await service.editFile(
            user.id,
            id,
            await jsonBody(req, filesSchema, 1_100_000),
          ),
        );
    }
    if (path[2] === "diff" && method === "GET")
      return json(await service.diff(user.id, id));
    if (path[2] === "resume" && method === "POST") {
      const project = await service.activate(user.id, id);
      await lifecycle(id);
      return json({ project });
    }
    if (path[2] === "suspend" && method === "POST") {
      if (
        (await store.runs(id)).some((run) =>
          ["queued", "running"].includes(run.status),
        )
      )
        throw new ApiError(409, "Cancel the active run before suspending.");
      return json({ project: await service.suspend(user.id, id) });
    }
    if (path[2] === "preview-session" && method === "POST") {
      const project = await service.activate(user.id, id);
      await lifecycle(id);
      const preview = await vm.startProjectPreview(project);
      return json({
        url: preview.previewUrl,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });
    }
    if (path[2] === "runs" && method === "POST") {
      const body = await jsonBody(req, runSchema);
      await service.activate(user.id, id);
      await lifecycle(id);
      const run = await store.createRun(user.id, id, {
        prompt: body.prompt,
        mode: body.mode,
        consentAt: new Date().toISOString(),
      });
      await store.event(run.id, "user", { text: body.prompt });
      try {
        const workflow = await start(cloudAgentWorkflow, [run.id]);
        await store.runState(run.id, "queued", workflow.runId);
      } catch (error) {
        await store.runState(run.id, "failed");
        throw error;
      }
      return json({ run }, 202);
    }
    if (path[2] === "publish" && method === "POST")
      return json(
        await service.publish(user.id, id, await jsonBody(req, publishSchema)),
      );
    throw new ApiError(404, "Cloud route not found.");
  });
}
