// Compose supplies credentials at runtime; never bake local environment files into images.
export {};
const password = process.env.FREECODA_DB_PASSWORD;
if (!password) throw Error("FREECODA_DB_PASSWORD is required for the local database.");
const database = new URL("postgresql://freecoda@db:5432/freecoda");
database.password = password;
process.env.DATABASE_URL = database.toString();
// Polling webpack watches reliably across Colima's shared filesystem. The image
// remains a frozen source snapshot when run without Compose's development binds.
const devOptions = process.env.FREECODA_DOCKER_DEV === "1" ? ["--webpack"] : [];
const command = process.argv[2] === "migrate"
  ? ["bun", "scripts/migrate.ts"]
  : ["bun", "--cwd", "apps/web", "next", "dev", ...devOptions, "--hostname", "0.0.0.0", "--port", "3010"];
const child = Bun.spawn(command, {
  env: process.env,
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
