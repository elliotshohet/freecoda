import { z } from "zod";
import { PREFERRED_FREE_MODEL } from "../free-model-selector";
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
import { projectExtensions, projectSkill, previewProjectPlugin, configureProjectExtensions, extensionActionSchema } from "./extensions";
import { configuredGithubRepositories } from "../github-repositories";
const idSchema = z.uuid();
const identifier = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const consent = z.literal(true);
// Bump this when cloud-storage consent terms or data scope materially change.
const cloudStorageConsentVersion = "cloud-storage-2026-10-v1";
const consentSchema = z.object({ version: z.string().min(1).max(80) }).strict();
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
const terminalSchema = z.object({ command: z.string().trim().min(1).max(4000) }).strict();
const runSchema = z
  .object({
    requestId: z.uuid().optional(),
    model: z.string().min(1).max(150).default(PREFERRED_FREE_MODEL),
    extensionConsent: z.boolean().default(false),
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
        userId: user && !user.device ? user.id : undefined,
        userName: user && !user.device ? user.name : undefined,
        userImage: user && !user.device ? user.image : undefined,
        models: ready ? (await service.configuredCloudModels()).map(config => ({ id: config.id, name: config.id })) : [],
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
    if (path.join("/") === "consent") {
      if (method === "GET")
        return json({
          version: cloudStorageConsentVersion,
          accepted: await store.hasCloudConsent(
            user.id,
            "cloud-storage",
            cloudStorageConsentVersion,
          ),
        });
      if (method === "POST") {
        const body = await jsonBody(req, consentSchema);
        if (body.version !== cloudStorageConsentVersion)
          throw new ApiError(409, "Cloud storage terms changed. Review them and try again.");
        await store.acknowledgeCloudConsent(
          user.id,
          "cloud-storage",
          cloudStorageConsentVersion,
        );
        return json({ version: cloudStorageConsentVersion, accepted: true });
      }
    }
    const controlAction = method === "DELETE" ||
      (method === "POST" && (path[0] === "runs" && path[2] === "cancel" || path[0] === "projects" && path[2] === "suspend"));
    if (method !== "GET" && !controlAction && !await store.hasCloudConsent(user.id, "cloud-storage", cloudStorageConsentVersion))
      throw new ApiError(403, "Review and accept the current cloud storage terms before continuing.");
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
      const configured = (await configuredGithubRepositories(user.id)).find(repo => repo.enabled && repo.installationId === body.installationId && repo.owner.toLowerCase() === body.owner.toLowerCase() && repo.name.toLowerCase() === body.repo.toLowerCase());
      const project = await store.createProject(user.id, body.repo, {
        files: [],
        repository: {
          installationId: body.installationId,
          owner: body.owner,
          name: body.repo,
          defaultBranch: body.ref || configured?.branch || "",
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
        { status: "creating", appDirectory: "/home/project/app" + (configured?.appDirectory ? "/" + configured.appDirectory : "") },
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
    if (path[2] === "sync") {
      if (method === "GET") return json(await service.repositorySyncStatus(user.id, id));
      if (method === "POST") {
        const body = await jsonBody(req, z.object({ expectedBaseSha: z.string().regex(/^[a-f0-9]{40}$/) }).strict());
        return json({ project: await service.pullRepository(user.id, id, body.expectedBaseSha) });
      }
    }
    if (path[2] === "plugins" && path[3] === "preview" && path.length === 4 && method === "POST") {
      const body = await jsonBody(req, z.object({ source: z.string().url().max(2000) }).strict());
      return json(await previewProjectPlugin(user.id, id, body.source));
    }
    if (path[2] === "extensions") {
      if (method === "GET") {
        const skillId = new URL(req.url).searchParams.get("skill");
        if (skillId !== null) {
          if (!skillId || skillId.length > 64) throw new ApiError(400, "Choose an installed skill.");
          return json({ skill: await projectSkill(user.id, id, skillId) });
        }
        return json(await projectExtensions(user.id, id));
      }
      if (method === "POST") return json(await configureProjectExtensions(user.id, id, await jsonBody(req, extensionActionSchema, 100_000)));
    }
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
    if (path[2] === "terminal" && method === "POST") {
      const body = await jsonBody(req, terminalSchema);
      const result = await service.runTerminalCommand(user.id, id, body.command);
      await lifecycle(id);
      return json(result);
    }
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
    if (path[2] === "preview-session" && method === "GET")
      return json(await service.previewSession(user.id, id));
    if (path[2] === "preview-session" && method === "POST") {
      const preview = await service.startPreviewSession(user.id, id);
      await lifecycle(id);
      return json(preview);
    }
    if (path[2] === "runs" && method === "POST") {
      const body = await jsonBody(req, runSchema);
      await service.requireCloudModel(body.model);
      if (body.requestId) {
        const existing = await store.findRunRequest(user.id, id, body.requestId, body);
        if (existing) return json({ run: existing }, 202);
      }
      if (body.mode === "build" && record.payload.extensions?.servers.some(server => server.enabled) && !body.extensionConsent)
        throw new ApiError(403, "Allow installed external tools for this run before starting.");
      await service.activate(user.id, id);
      await lifecycle(id);
      const { run, created } = await store.createRunRequest(user.id, id, {
        extensionConsent: body.extensionConsent,
        model: body.model,
        prompt: body.prompt,
        mode: body.mode,
        consentAt: new Date().toISOString(),
      }, body.requestId);
      if (!created) return json({ run }, 202);
      await store.event(run.id, "user", { text: body.prompt, messageId: run.id });
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
