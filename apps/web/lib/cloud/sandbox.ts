import {
  APIError,
  Sandbox,
  SandboxUserAlreadyExistsError,
  Snapshot,
} from "@vercel/sandbox";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { ApiError } from "../http";
import {
  createPreviewTicket,
  previewPublicKey,
  PREVIEW_PROXY_SOURCE,
} from "./preview-proxy";

export type SandboxProjectRef = {
  id: string;
  sandboxId?: string | null;
  snapshotId?: string | null;
  appDirectory?: string | null;
};
export type SandboxSourceFile = {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  mode?: "100644" | "100755";
};
export const PROJECT_ROOT = "/home/project/app";
export const SOURCE_LIMIT = 100 * 1024 * 1024;
export const SANDBOX_TIMEOUT = 15 * 60 * 1000;
export const SNAPSHOT_EXPIRATION = 7 * 24 * 60 * 60 * 1000;
const FILE_LIMIT = 1024 * 1024;
const HELPER = "/opt/freecoda/files.py";
const NETWORK_POLICY = {
  allow: { "registry.npmjs.org": [], "registry.yarnpkg.com": [] },
};
const deniedParts =
  /^(?:\.git|node_modules|\.next|\.nuxt|\.output|\.cache|\.turbo|\.swc|dist|build|coverage|\.vercel|\.aws|\.ssh|\.gnupg|__pycache__|\.venv|venv|\.data)$/i;
const deniedNames =
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\..*)?|secrets?(?:\..*)?|next-env[.]d[.]ts|id_rsa.*|id_ed25519.*|.*\.(?:pem|key|p12|pfx|pyc))$/i;
export function validSourcePath(value: string) {
  if (
    !value ||
    value.length > 500 ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    /(?:^|\/)\.well-known\/workflow\/v1(?:\/|$)/i.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          deniedParts.test(part) ||
          deniedNames.test(part),
      )
  )
    throw new ApiError(
      400,
      "Use a source path without secrets, build files, or traversal.",
    );
  return value;
}
export function validateSourceFiles(files: SandboxSourceFile[]) {
  if (files.length > 10_000)
    throw new ApiError(
      413,
      "A project may contain at most 10,000 source files.",
    );
  let total = 0;
  const seen = new Set<string>();
  return files.map((file) => {
    validSourcePath(file.path);
    if (seen.has(file.path)) throw new ApiError(400, "Duplicate source path.");
    seen.add(file.path);
    const content = Buffer.from(
      file.content,
      file.encoding === "base64" ? "base64" : "utf8",
    );
    total += content.byteLength;
    if (total > SOURCE_LIMIT)
      throw new ApiError(413, "Project source must be under 100 MB.");
    return {
      path: file.path,
      content,
      mode: file.mode === "100755" ? 0o755 : 0o644,
    };
  });
}

// Invoked with isolated Python as the unprivileged project user. File walks
// never follow symlinks; editor writes compare the current SHA-256 immediately
// before an atomic replacement. All source operations share the same exclusions.
export const SOURCE_HELPER = String.raw`
import os,sys,json,hashlib,base64,stat,tempfile,subprocess,selectors,time,signal,fcntl
LIMIT=104857600
FILE_LIMIT=1048576
BAD_DIRS={'.git','node_modules','.next','.nuxt','.output','.cache','.turbo','.swc','dist','build','coverage','.vercel','.aws','.ssh','.gnupg','__pycache__','.venv','venv','.data'}
import re
BAD_NAME=re.compile(r'^(?:[.]env(?:[.].*)?|[.]npmrc|[.]netrc|credentials(?:[.].*)?|secrets?(?:[.].*)?|next-env[.]d[.]ts|id_rsa.*|id_ed25519.*|.*[.](?:pem|key|p12|pfx|pyc))$',re.I)
p=json.load(sys.stdin)
root=os.path.abspath(p['root'])
def allowed(rel):
 parts=rel.split('/')
 if any([p.lower() for p in parts[i:i+3]]==['.well-known','workflow','v1'] for i in range(max(0,len(parts)-2))):return False
 return bool(rel) and len(rel)<=500 and not rel.startswith('/') and chr(92) not in rel and chr(0) not in rel and all(x not in ('','.','..') and x.lower() not in BAD_DIRS and not BAD_NAME.match(x) for x in parts)
def target(rel,new=False):
 if not allowed(rel):raise ValueError('Source path is excluded or invalid.')
 cur=root
 for part in rel.split('/'):
  cur=os.path.join(cur,part)
  try:
   if stat.S_ISLNK(os.lstat(cur).st_mode):raise ValueError('Symlinks are excluded.')
  except FileNotFoundError:
   if not new:raise
 return cur
def scan():
 result=[];total=0;count=0
 for directory,dirs,files in os.walk(root,followlinks=False):
  dirs[:]=[x for x in dirs if allowed(os.path.relpath(os.path.join(directory,x),root).replace(os.sep,'/')) and not os.path.islink(os.path.join(directory,x))]
  for name in files:
   rel=os.path.relpath(os.path.join(directory,name),root).replace(os.sep,'/')
   if not allowed(rel) or os.path.islink(os.path.join(directory,name)):continue
   filename=target(rel)
   info=os.lstat(filename)
   if not stat.S_ISREG(info.st_mode):continue
   count+=1;total+=info.st_size
   if count>10000 or total>LIMIT:raise ValueError('Project source exceeds 100 MB or 10,000 files.')
   result.append((rel,info.st_size))
 return sorted(result)
def read_bytes(filename):
 fd=os.open(filename,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:return f.read(LIMIT+1)
def sha(data):return hashlib.sha256(data).hexdigest()
try:
 if os.path.islink(root):raise ValueError('Symlink project roots are excluded.')
 op=p['op']
 if op=='list':out=[{'path':rel,'bytes':size} for rel,size in scan()]
 elif op=='read':
  filename=target(p['path']);size=os.stat(filename).st_size
  if size>FILE_LIMIT:raise ValueError('Editor text files must be under 1 MB.')
  data=read_bytes(filename)
  if bytes([0]) in data:raise ValueError('Binary files cannot be opened in the text editor.')
  out={'path':p['path'],'content':data.decode('utf8'),'hash':sha(data)}
 elif op=='edit':
  lockfd=os.open(os.path.join(os.path.dirname(root),'.freecoda-source.lock'),os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
  fcntl.flock(lockfd,fcntl.LOCK_EX)
  filename=target(p['path'],True);data=p['content'].encode('utf8')
  if len(data)>FILE_LIMIT:raise ValueError('Editor text files must be under 1 MB.')
  try:old=read_bytes(filename)
  except FileNotFoundError:old=None
  expected=p.get('expectedHash')
  if (expected is None and old is not None) or (expected is not None and (old is None or sha(old)!=expected)):raise ValueError('File changed. Reload it before saving.')
  total=sum(size for _,size in scan())-(len(old) if old is not None else 0)+len(data)
  if total>LIMIT:raise ValueError('Project source exceeds 100 MB.')
  os.makedirs(os.path.dirname(filename),exist_ok=True);target(p['path'],True)
  fd,temp=tempfile.mkstemp(prefix='.freecoda-edit-',dir=os.path.dirname(filename))
  try:
   with os.fdopen(fd,'wb') as f:f.write(data)
   if old is not None:os.chmod(temp,os.stat(filename,follow_symlinks=False).st_mode&0o777)
   target(p['path'],True)
   try:current=read_bytes(filename)
   except FileNotFoundError:current=None
   if current!=old:raise ValueError('File changed while saving. Reload it.')
   os.replace(temp,filename)
  finally:
   if os.path.exists(temp):os.unlink(temp)
  out={'path':p['path'],'hash':sha(data)}
 elif op=='command':
  cwd=p.get('cwd',root)
  if os.path.commonpath([root,os.path.abspath(cwd)])!=root or os.path.realpath(cwd)!=os.path.abspath(cwd):raise ValueError('Invalid command directory.')
  env={'HOME':'/home/project','USER':'project','PATH':'/usr/local/bin:/usr/bin:/bin','CI':'1','NEXT_TELEMETRY_DISABLED':'1','npm_config_cache':'/home/project/.npm'}
  process=subprocess.Popen(['/bin/bash','--noprofile','--norc','-c',p['command']],cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  streams=selectors.DefaultSelector();streams.register(process.stdout,selectors.EVENT_READ,'stdout');streams.register(process.stderr,selectors.EVENT_READ,'stderr')
  output={'stdout':bytearray(),'stderr':bytearray()};deadline=time.monotonic()+p.get('timeoutMs',60000)/1000;timedout=False
  while streams.get_map():
   if time.monotonic()>deadline:
    timedout=True
    try:os.killpg(process.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   for key,_ in streams.select(0.05):
    chunk=os.read(key.fd,8192)
    if not chunk:streams.unregister(key.fileobj);continue
    remaining=max(0,32000-len(output[key.data]));output[key.data].extend(chunk[:remaining])
   if timedout and time.monotonic()>deadline+2:break
  process.wait(timeout=3)
  out={'exitCode':124 if timedout else process.returncode,'stdout':bytes(output['stdout']).decode('utf8','replace'),'stderr':bytes(output['stderr']).decode('utf8','replace')+('\nCommand timed out.' if timedout else '')}
 elif op=='export':
  out=[]
  for rel,size in scan():
   data=read_bytes(target(rel))
   try:
    text=data.decode('utf8')
    if chr(0) in text:raise ValueError()
    item={'path':rel,'content':text}
    if os.stat(target(rel),follow_symlinks=False).st_mode&0o111:item['mode']='100755'
    out.append(item)
   except (UnicodeDecodeError,ValueError):
    item={'path':rel,'content':base64.b64encode(data).decode(),'encoding':'base64'}
    if os.stat(target(rel),follow_symlinks=False).st_mode&0o111:item['mode']='100755'
    out.append(item)
 else:raise ValueError('Unknown source operation.')
 print(json.dumps({'ok':True,'value':out}))
except Exception as e:
 print(json.dumps({'ok':False,'error':str(e)}));sys.exit(1)
`;

function projectRoot(project: SandboxProjectRef) {
  const directory =
    !project.appDirectory ||
    project.appDirectory === "/vercel/sandbox" ||
    project.appDirectory === "/vercel/sandbox/project"
      ? PROJECT_ROOT
      : project.appDirectory;
  if (directory !== PROJECT_ROOT && !directory.startsWith(PROJECT_ROOT + "/"))
    throw new ApiError(400, "Invalid project directory.");
  if (path.posix.normalize(directory) !== directory)
    throw new ApiError(400, "Invalid project directory.");
  return directory;
}
async function getSandbox(project: SandboxProjectRef) {
  if (!project.sandboxId)
    throw new ApiError(409, "Resume the project sandbox first.");
  const sandbox = await Sandbox.get({ name: project.sandboxId, resume: false });
  if (sandbox.status !== "running")
    throw new ApiError(
      409,
      "The sandbox stopped. Resume the saved project to continue.",
    );
  await ensureSourceTools(sandbox);
  return sandbox;
}
async function createUsers(sandbox: Sandbox) {
  for (const user of ["project", "preview"]) {
    try {
      await sandbox.createUser(user);
    } catch (error) {
      if (!(error instanceof SandboxUserAlreadyExistsError)) throw error;
    }
  }
  const setup = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      "mkdir -p /opt/freecoda /home/project/app && chown project:project /home/project/app && chmod 770 /home/preview && chmod 755 /opt/freecoda",
    ],
    sudo: true,
  });
  if (setup.exitCode !== 0)
    throw new Error("Could not initialize the isolated workspace.");
  await installSourceTools(sandbox);
}
const helperVersion = createHash("sha256").update(SOURCE_HELPER).digest("hex");
const activeHelperPath = HELPER + "." + helperVersion + ".py";
const readyHelpers = new Map<string, string>();
async function ensureSourceTools(sandbox: Sandbox) {
  if (readyHelpers.get(sandbox.name) === helperVersion) return;
  const current = await sandbox.readFileToBuffer({ path: activeHelperPath });
  if (
    !current ||
    createHash("sha256").update(current).digest("hex") !== helperVersion
  )
    await installSourceTools(sandbox);
  else readyHelpers.set(sandbox.name, helperVersion);
}
async function installSourceTools(sandbox: Sandbox) {
  const temporary = activeHelperPath + "." + randomUUID() + ".tmp";
  const helper = await sandbox.runCommand({
    cmd: "tee",
    args: [temporary],
    stdin: true,
    detached: true,
    sudo: true,
    timeoutMs: 20000,
  });
  await helper.writeStdin(Buffer.from(SOURCE_HELPER));
  await helper.closeStdin();
  if ((await helper.wait()).exitCode !== 0)
    throw new Error("Could not install source tools.");
  const mode = await sandbox.runCommand({
    cmd: "chmod",
    args: ["555", temporary],
    sudo: true,
  });
  const moved = await sandbox.runCommand({
    cmd: "mv",
    args: ["-f", temporary, activeHelperPath],
    sudo: true,
  });
  if (mode.exitCode !== 0 || moved.exitCode !== 0)
    throw new Error("Could not activate source tools.");
  if (readyHelpers.size >= 256) readyHelpers.clear();
  readyHelpers.set(sandbox.name, helperVersion);
}
async function installPreviewProxy(sandbox: Sandbox, projectId: string) {
  const ports = await sandbox.runCommand({
    cmd: "sysctl",
    args: ["-w", "net.ipv4.ip_unprivileged_port_start=3001"],
    sudo: true,
  });
  if (ports.exitCode !== 0)
    throw new Error("Could not protect the preview port.");
  await sandbox.asUser("preview").writeFiles([
    { path: "proxy.mjs", content: PREVIEW_PROXY_SOURCE, mode: 0o500 },
    {
      path: "config.json",
      content: JSON.stringify({
        projectId,
        sandboxId: sandbox.name,
        publicKey: previewPublicKey(),
        port: 3000,
        appPort: 3001,
      }),
      mode: 0o400,
    },
  ]);
  await sandbox.runCommand({
    cmd: "setpriv",
    args: [
      "--reuid=preview",
      "--regid=preview",
      "--init-groups",
      "--inh-caps=+net_bind_service",
      "--ambient-caps=+net_bind_service",
      "node",
      "/home/preview/proxy.mjs",
      "/home/preview/config.json",
    ],
    sudo: true,
    detached: true,
    timeoutMs: SANDBOX_TIMEOUT,
  });
  const ready = await sandbox.asUser("preview").runCommand({
    cmd: "node",
    args: [
      "-e",
      "(async()=>{for(let i=0;i<20;i++){try{const r=await fetch('http://127.0.0.1:3000',{signal:AbortSignal.timeout(500)});if(r.status===401)return;}catch{}await new Promise(r=>setTimeout(r,100));}process.exit(1)})()",
    ],
    timeoutMs: 5000,
  });
  if (ready.exitCode !== 0)
    throw new Error("The private preview proxy did not start.");
}
async function createSandbox(project: SandboxProjectRef, restore = true) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(project.id))
    throw new ApiError(400, "Invalid project identifier.");
  const sandbox = await Sandbox.create({
    resources: { vcpus: 2 },
    timeout: SANDBOX_TIMEOUT,
    persistent: false,
    ports: [3000],
    networkPolicy: NETWORK_POLICY,
    snapshotExpiration: SNAPSHOT_EXPIRATION,
    ...(restore && project.snapshotId
      ? {
          source: { type: "snapshot" as const, snapshotId: project.snapshotId },
        }
      : { image: "vercel/sandbox/universal" as const }),
  });
  try {
    await createUsers(sandbox);
    return sandbox;
  } catch (error) {
    await sandbox.stop().catch(() => {});
    throw error;
  }
}
export async function ensureProjectSandbox(
  project: SandboxProjectRef,
  initialFiles: SandboxSourceFile[] = [],
) {
  if (project.sandboxId) {
    const sandbox = await getSandbox(project);
    return { sandboxId: sandbox.name, appDirectory: projectRoot(project) };
  }
  let files: ReturnType<typeof validateSourceFiles>;
  try {
    files = validateSourceFiles(initialFiles);
    projectRoot(project);
    previewPublicKey();
  } catch (error) {
    if (error instanceof Error)
      Object.assign(error, { noResourceCreated: true });
    throw error;
  }
  const sandbox = await createSandbox(project);
  try {
    await installPreviewProxy(sandbox, project.id);
    if (!project.snapshotId && files.length) {
      await sandbox.asUser("project").writeFiles(
        files.map((file) => ({
          path: PROJECT_ROOT + "/" + file.path,
          content: file.content,
          mode: file.mode,
        })),
      );
    }
    return { sandboxId: sandbox.name, appDirectory: projectRoot(project) };
  } catch (error) {
    await sandbox.stop().catch(() => {});
    throw error;
  }
}
async function sourceOperation<T>(
  project: SandboxProjectRef,
  payload: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  const sandbox = await getSandbox(project);
  const command = await sandbox.asUser("project").runCommand({
    cmd: "/usr/bin/python3",
    args: ["-I", activeHelperPath],
    stdin: true,
    detached: true,
    timeoutMs,
  });
  await command.writeStdin(
    Buffer.from(JSON.stringify({ ...payload, root: PROJECT_ROOT })),
  );
  await command.closeStdin();
  const result = await command.wait();
  let response;
  try {
    response = JSON.parse(await result.stdout()) as {
      ok: boolean;
      value: T;
      error: string;
    };
  } catch {
    throw new ApiError(503, "The source operation did not complete.");
  }
  if (!response.ok || result.exitCode !== 0)
    throw new ApiError(
      response.error?.includes("changed") ? 409 : 400,
      response.error || "Source operation failed.",
    );
  return response.value;
}
export async function listProjectFiles(project: SandboxProjectRef) {
  return sourceOperation<{ path: string; bytes: number }[]>(project, {
    op: "list",
  });
}
export async function readProjectFile(
  project: SandboxProjectRef,
  file: string,
) {
  validSourcePath(file);
  return sourceOperation<{ path: string; content: string; hash: string }>(
    project,
    { op: "read", path: file },
  );
}
export async function editProjectFile(
  project: SandboxProjectRef,
  input: { path: string; content: string; expectedHash: string | null },
) {
  validSourcePath(input.path);
  if (Buffer.byteLength(input.content) > FILE_LIMIT)
    throw new ApiError(413, "Editor text files must be under 1 MB.");
  if (input.expectedHash !== null && !/^[a-f0-9]{64}$/.test(input.expectedHash))
    throw new ApiError(400, "Read the current file before editing.");
  return sourceOperation<{ path: string; hash: string }>(project, {
    op: "edit",
    ...input,
  });
}
export async function exportProjectSource(project: SandboxProjectRef) {
  return sourceOperation<SandboxSourceFile[]>(project, { op: "export" });
}
const cleanEnv = [
  "-i",
  "HOME=/home/project",
  "USER=project",
  "PATH=/usr/local/bin:/usr/bin:/bin",
  "CI=1",
  "NEXT_TELEMETRY_DISABLED=1",
  "npm_config_cache=/home/project/.npm",
];
export async function runProjectCommand(
  project: SandboxProjectRef,
  input: { command: string; timeoutMs?: number },
) {
  if (!input.command || input.command.length > 8000)
    throw new ApiError(400, "Command must contain at most 8,000 characters.");
  const timeoutMs = Math.max(
    1000,
    Math.min(input.timeoutMs || 60_000, 120_000),
  );
  return sourceOperation<{ exitCode: number; stdout: string; stderr: string }>(
    project,
    {
      op: "command",
      command: input.command,
      timeoutMs,
      cwd: projectRoot(project),
    },
    timeoutMs + 5000,
  );
}

type PackageManifest = {
  packageManager?: string;
  workspaces?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
export function previewInstallPlan(
  rootPackage: PackageManifest | undefined,
  appPackage: PackageManifest,
  files: { path: string }[],
  appDirectory = PROJECT_ROOT,
) {
  const rootLocks = [
    "bun.lock",
    "bun.lockb",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
  ];
  const atRoot = new Set(
    files.filter((f) => !f.path.includes("/")).map((f) => f.path),
  );
  const useRoot =
    !!rootPackage &&
    (appDirectory === PROJECT_ROOT ||
      !!rootPackage.workspaces ||
      rootLocks.some((lock) => atRoot.has(lock)));
  const pkg = useRoot ? rootPackage! : appPackage;
  const relative = useRoot
    ? ""
    : path.posix.relative(PROJECT_ROOT, appDirectory);
  const names = new Set(
    files
      .filter((f) => path.posix.dirname(f.path) === (relative || "."))
      .map((f) => path.posix.basename(f.path)),
  );
  let manager: string | undefined, version: string | undefined;
  if (pkg.packageManager) {
    const match =
      /^(npm|pnpm|yarn|bun)@(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)(?:\+sha\d+\.[A-Za-z0-9]+)?$/.exec(
        pkg.packageManager,
      );
    if (!match)
      throw new ApiError(
        400,
        "Use a pinned npm, pnpm, Yarn, or Bun packageManager version.",
      );
    manager = match[1];
    version = match[2];
  }
  manager ??=
    names.has("bun.lock") || names.has("bun.lockb")
      ? "bun"
      : names.has("pnpm-lock.yaml")
        ? "pnpm"
        : names.has("yarn.lock")
          ? "yarn"
          : "npm";
  let command: string;
  if (manager === "bun")
    command = `npm exec --yes --package=bun@${version || "1.3.14"} -- bun install --ignore-scripts`;
  else if (manager === "pnpm")
    command = `npm exec --yes --package=pnpm@${version || "9.15.9"} -- pnpm install --ignore-scripts --reporter=append-only`;
  else if (manager === "yarn") {
    const v = version || "1.22.22";
    command =
      Number(v.split(".")[0]) >= 2
        ? `YARN_ENABLE_SCRIPTS=false npm exec --yes --package=@yarnpkg/cli-dist@${v} -- yarn install`
        : `npm exec --yes --package=yarn@${v} -- yarn install --ignore-scripts --non-interactive`;
  } else
    command = version
      ? `npm exec --yes --package=npm@${version} -- npm install --ignore-scripts --no-audit --no-fund`
      : "npm install --ignore-scripts --no-audit --no-fund";
  return {
    command,
    appDirectory: useRoot ? PROJECT_ROOT : appDirectory,
    manager,
  };
}

export async function startProjectPreview(project: SandboxProjectRef) {
  const sandbox = await getSandbox(project);
  const directory = projectRoot(project);
  const pkgResult = await readProjectFile(
    { ...project, appDirectory: PROJECT_ROOT },
    path.posix.relative(PROJECT_ROOT, directory + "/package.json"),
  );
  let pkg: PackageManifest;
  try {
    pkg = JSON.parse(pkgResult.content);
  } catch {
    throw new ApiError(400, "A valid package.json is required for preview.");
  }
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework = dependencies.next
    ? "next"
    : dependencies.vite
      ? "vite"
      : undefined;
  if (!framework)
    throw new ApiError(
      400,
      "Preview currently supports Next.js and Vite projects.",
    );
  // Resolve from the selected app, including hoisted/linked monorepo installs.
  const relativeBinary = framework === "next" ? "dist/bin/next" : "bin/vite.js";
  const resolveBinary = `const p=require('node:path');const binary=p.join(p.dirname(require.resolve('${framework}/package.json')),'${relativeBinary}');`;
  const frameworkArgs =
    framework === "next"
      ? ["dev", "--hostname", "127.0.0.1", "--port", "3001"]
      : ["--host", "127.0.0.1", "--port", "3001", "--strictPort"];
  const resolveInstalledBinary = () =>
    sandbox.asUser("project").runCommand({
      cmd: "node",
      args: ["-e", resolveBinary + "console.log(binary);"],
      cwd: directory,
      timeoutMs: 5000,
    });
  let installed = await resolveInstalledBinary();
  if (installed.exitCode !== 0) {
    const files = await listProjectFiles(project);
    let rootPackage: PackageManifest | undefined;
    try {
      rootPackage = JSON.parse(
        (await readProjectFile(project, "package.json")).content,
      );
    } catch {}
    const plan = previewInstallPlan(rootPackage, pkg, files, directory);
    const installation = await runProjectCommand(
      { ...project, appDirectory: plan.appDirectory },
      { command: plan.command, timeoutMs: 120000 },
    );
    if (installation.exitCode !== 0)
      throw new ApiError(
        503,
        "Project dependencies could not be installed. Check the package manager, package.json, and install requirements in the workspace.",
      );
  }
  if (installed.exitCode !== 0) installed = await resolveInstalledBinary();
  if (installed.exitCode !== 0)
    throw new ApiError(
      503,
      "The project framework executable is unavailable after dependency installation.",
    );
  const binary = (await installed.stdout()).trim();
  if (
    !binary.startsWith(PROJECT_ROOT + "/") ||
    binary.includes("\n") ||
    binary.includes("\0")
  )
    throw new ApiError(
      400,
      "The preview executable must be installed inside the project.",
    );
  // Launch the executable directly: Next forks child servers and must not
  // inherit an eval (-e) entry in process.execArgv.
  const serverArgs = [binary, ...frameworkArgs];
  const ping = await sandbox.asUser("project").runCommand({
    cmd: "node",
    args: [
      "-e",
      "fetch('http://127.0.0.1:3001',{signal:AbortSignal.timeout(1000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))",
    ],
    timeoutMs: 3000,
  });
  if (ping.exitCode !== 0)
    await sandbox.asUser("project").runCommand({
      cmd: "/usr/bin/env",
      args: [...cleanEnv, "node", ...serverArgs],
      cwd: directory,
      detached: true,
      timeoutMs: SANDBOX_TIMEOUT,
    });
  let ready = false;
  for (let i = 0; i < 12; i++) {
    const check = await sandbox.asUser("preview").runCommand({
      cmd: "node",
      args: [
        "-e",
        "fetch('http://127.0.0.1:3001',{signal:AbortSignal.timeout(2000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))",
      ],
      timeoutMs: 3000,
    });
    if (check.exitCode === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready)
    throw new ApiError(
      503,
      "The preview server has not started. Install project dependencies and check the terminal.",
    );
  const ticket = createPreviewTicket(project.id, sandbox.name);
  return {
    sandboxId: sandbox.name,
    previewUrl: `${sandbox.domain(3000)}/?ticket=${encodeURIComponent(ticket.token)}`,
    previewToken: ticket.token,
    expiresAt: ticket.expiresAt,
  };
}
/** Persist exportProjectSource() in the encrypted project archive before calling. */
export async function suspendProjectSandbox(project: SandboxProjectRef) {
  await stopProjectSandbox(project);
  return { sandboxId: null, snapshotId: null };
}
export async function stopProjectCommands(project: SandboxProjectRef) {
  if (!project.sandboxId) return;
  const sandbox = await Sandbox.get({ name: project.sandboxId, resume: false });
  if (sandbox.status !== "running") return;
  const result = await sandbox.runCommand({
    cmd: "pkill",
    args: ["-KILL", "-u", "project"],
    sudo: true,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1)
    throw new Error("Could not stop the project commands.");
}
export async function stopProjectSandbox(project: SandboxProjectRef) {
  if (!project.sandboxId) return;
  try {
    const sandbox = await Sandbox.get({
      name: project.sandboxId,
      resume: false,
    });
    if (["stopped", "stopping", "failed"].includes(sandbox.status)) return;
    await sandbox.stop();
  } catch (error) {
    if (!(error instanceof APIError && error.response.status === 404))
      throw error;
  }
}
export async function deleteProjectSnapshot(snapshotId: string) {
  try {
    await (await Snapshot.get({ snapshotId })).delete();
  } catch (error) {
    if (!(error instanceof APIError && error.response.status === 404))
      throw error;
  }
}
export const sourceHash = (content: string) =>
  createHash("sha256").update(content).digest("hex");
