import { z } from "zod";
import {
  emptyExtensionRegistry, parseExtensionRegistry, publicExtensions,
  installRemoteSkill as installSkill, installSkillFromText, installMcpServer,
  setExtensionEnabled, removeExtension, validateExtensionUrl,
} from "../../../../packages/core/src/extensions";
import { ApiError } from "../http";
import * as store from "./store";

export const extensionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skill-url"), source: z.string().url().max(2000) }).strict(),
  z.object({ action: z.literal("skill-text"), name: z.string().trim().min(1).max(100), instructions: z.string().min(1).max(48000) }).strict(),
  z.object({ action: z.literal("mcp"), name: z.string().trim().min(1).max(100), url: z.string().url().max(2000) }).strict(),
  z.object({ action: z.literal("toggle"), id: z.string().max(64), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("remove"), id: z.string().max(64) }).strict(),
]);
export async function projectExtensions(userId: string, projectId: string) {
  const record = await store.project(userId, projectId);
  return publicExtensions(parseExtensionRegistry(record.payload.extensions || emptyExtensionRegistry()));
}
export async function configureProjectExtensions(userId: string, projectId: string, action: z.infer<typeof extensionActionSchema>) {
  return store.withProjectOperation(userId, projectId, async () => {
    const record = await store.project(userId, projectId);
    let registry = parseExtensionRegistry(record.payload.extensions || emptyExtensionRegistry());
    try {
      if (action.action === "skill-url") {
        validateExtensionUrl(action.source);
        registry = await installSkill(registry, { source: action.source, allowLocal: false });
      } else if (action.action === "skill-text") {
        registry = installSkillFromText(registry, { name: action.name, instructions: action.instructions });
      } else if (action.action === "mcp") {
        validateExtensionUrl(action.url);
        registry = installMcpServer(registry, { name: action.name, url: action.url });
      } else if (action.action === "toggle") registry = setExtensionEnabled(registry, action.id, action.enabled);
      else registry = removeExtension(registry, action.id);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "Invalid extension configuration.");
    }
    await store.saveProject(userId, projectId, record.version, { ...record.payload, extensions: registry });
    return publicExtensions(registry);
  });
}
