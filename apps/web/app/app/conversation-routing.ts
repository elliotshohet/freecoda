import { parseConversationCommand, parseSkillInstallIntent } from "@freecoda/contracts";

const projectCommands = new Set(["/project", "/repos", "/build", "/plan", "/review", "/files", "/changes", "/preview", "/output", "/sync", "/diff", "/start", "/suspend", "/skills", "/plugins", "/extensions", "/mcp", "/tools", "/permissions"]);

/** Commands bypass prompt queues and inference. Opening a project control grants no access. */
export function interceptWebConversationInput(text: string, handlers: { project: (command: string) => void; conversation: (command: string) => void }): boolean {
  const skill = parseSkillInstallIntent(text);
  if (skill) { handlers.project(`/skills${skill.source ? ` install ${skill.source}` : ""}`); return true; }
  const command = parseConversationCommand(text);
  if (!command) return false;
  if (projectCommands.has(command.name) || (command.name === "/mode" && ["build", "plan", "review"].includes(command.argument))) handlers.project(text);
  else handlers.conversation(text);
  return true;
}
