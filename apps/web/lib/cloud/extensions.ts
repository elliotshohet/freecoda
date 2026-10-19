import { z } from "zod";
import {
  emptyExtensionRegistry, parseExtensionRegistry, publicExtensions,
  installRemoteSkill as installSkill, installSkillFromText, installMcpServer,
  setExtensionEnabled, removeExtension, validateExtensionUrl, connectExtensionTools, fetchPluginManifest, installPlugin, removePlugin,
} from "../../../../packages/core/src/extensions";
import { pluginManifestSchema } from "@freecoda/contracts";
import { ApiError } from "../http";
import * as store from "./store";
import type { ProjectPayload } from "./types";

export const extensionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skill-url"), source: z.string().url().max(2000) }).strict(),
  z.object({ action: z.literal("skill-text"), name: z.string().trim().min(1).max(100), instructions: z.string().min(1).max(48000) }).strict(),
  z.object({ action: z.literal("mcp"), name: z.string().trim().min(1).max(100), url: z.string().url().max(2000) }).strict(),
  z.object({ action: z.literal("toggle"), id: z.string().max(64), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("discover"), id: z.string().min(1).max(64) }).strict(),
  z.object({ action: z.literal("tool-toggle"), name: z.string().min(1).max(64), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("remove"), id: z.string().max(64) }).strict(),
  z.object({ action: z.literal("plugin-install"), source: z.string().url().max(2000), manifest: pluginManifestSchema }).strict(),
  z.object({ action: z.literal("plugin-remove"), id: z.string().min(1).max(64) }).strict(),
]);
export const builtinProjectTools = ["list_files", "read_file", "write_file", "shell", "skill_file"] as const;
export function selectProjectTools<T>(tools: Record<string, T>, disabled: string[] = []): Record<string, T> {
  const denied = new Set(disabled);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !denied.has(name)));
}
export function publicProjectExtensions(payload: Pick<ProjectPayload, "extensions" | "disabledTools" | "mcpToolCatalog">) {
  const registry = publicExtensions(parseExtensionRegistry(payload.extensions || emptyExtensionRegistry()));
  return {
    ...registry,
    builtins: builtinProjectTools.filter(name => name !== "skill_file" || registry.skills.some(skill => skill.enabled)).map(name => ({ name, label: name.replaceAll("_", " "), buildOnly: name === "write_file" || name === "shell" })),
    disabledTools: payload.disabledTools || [],
    servers: registry.servers.map(server => ({
      ...server,
      status: payload.mcpToolCatalog?.[server.id] ? "available" : "not-checked",
      checkedAt: payload.mcpToolCatalog?.[server.id]?.checkedAt || null,
      tools: payload.mcpToolCatalog?.[server.id]?.tools || [],
    })),
  };
}
export async function discoverProjectTools(registry: ReturnType<typeof emptyExtensionRegistry>, id: string, connector = connectExtensionTools) {
  const server = registry.servers.find(server => server.id === id);
  if (!server) throw new ApiError(400, "MCP server not found.");
  let connection: Awaited<ReturnType<typeof connectExtensionTools>> | undefined;
  try {
    connection = await connector({ version: 1, skills: [], servers: [{ ...server, enabled: true }] }, {
      allowLocal: false, readOnly: false, signal: AbortSignal.timeout(20_000), approve: async () => false,
    });
    return {
      checkedAt: new Date().toISOString(),
      tools: Object.entries(connection.tools).map(([name, definition]) => ({
        name,
        ...(typeof definition.description === "string" ? { description: definition.description.slice(0, 2000) } : {}),
      })),
    };
  } catch {
    throw new ApiError(502, "MCP tool discovery failed. Check the server connection and retry.");
  } finally {
    await connection?.close().catch(() => {});
  }
}
export async function projectExtensions(userId: string, projectId: string) {
  return publicProjectExtensions((await store.project(userId, projectId)).payload);
}
export async function previewProjectPlugin(userId: string, projectId: string, source: string) {
  const record = await store.project(userId, projectId);
  if (!record.payload.consentAt) throw new ApiError(403, "Cloud project consent is required.");
  try {
    const manifest = await fetchPluginManifest(source, { allowLocal: false });
    for (const skill of manifest.skills) validateExtensionUrl(skill.source, false);
    for (const server of manifest.servers) validateExtensionUrl(server.url, false);
    return { source, manifest };
  }
  catch { throw new ApiError(400, "Could not read this plugin manifest. Use a public HTTPS JSON manifest without credentials."); }
}
/** Owner-scoped read of one installed skill; never returns MCP configuration. */
export async function projectSkill(userId: string, projectId: string, skillId: string) {
  const record = await store.project(userId, projectId);
  if (!record.payload.consentAt) throw new ApiError(403, "Cloud project consent is required.");
  const registry = parseExtensionRegistry(record.payload.extensions || emptyExtensionRegistry());
  const skill = registry.skills.find(entry => entry.id === skillId);
  if (!skill) throw new ApiError(404, "Skill was not found in this project.");
  return { id: skill.id, name: skill.name, instructions: skill.instructions, source: skill.source, enabled: skill.enabled };
}
export async function configureProjectExtensions(userId: string, projectId: string, action: z.infer<typeof extensionActionSchema>) {
  return store.withProjectOperation(userId, projectId, async () => {
    const record = await store.project(userId, projectId);
    let registry = parseExtensionRegistry(record.payload.extensions || emptyExtensionRegistry());
    let payload = { ...record.payload };
    try {
      if (action.action === "plugin-install") {
        if (!record.payload.consentAt) throw new ApiError(403, "Cloud project consent is required.");
        registry = await installPlugin(registry, { manifest: action.manifest, source: action.source, allowLocal: false });
      } else if (action.action === "plugin-remove") {
        const plugin = registry.plugins?.find(entry => entry.id === action.id);
        registry = removePlugin(registry, action.id);
        if (payload.mcpToolCatalog && plugin) {
          payload.mcpToolCatalog = { ...payload.mcpToolCatalog };
          for (const id of plugin.serverIds) delete payload.mcpToolCatalog[id];
        }
      } else if (action.action === "discover") {
        const catalog = await discoverProjectTools(registry, action.id);
        payload.mcpToolCatalog = { ...payload.mcpToolCatalog, [action.id]: catalog };
      } else if (action.action === "tool-toggle") {
        const known = new Set<string>([...builtinProjectTools, ...Object.values(payload.mcpToolCatalog || {}).flatMap(entry => entry.tools.map(tool => tool.name))]);
        if (!known.has(action.name)) throw new Error("Discover the tool before changing its availability.");
        const disabled = new Set(payload.disabledTools || []);
        if (action.enabled) disabled.delete(action.name); else disabled.add(action.name);
        payload.disabledTools = [...disabled];
      } else if (action.action === "skill-url") {
        validateExtensionUrl(action.source);
        registry = await installSkill(registry, { source: action.source, allowLocal: false });
      } else if (action.action === "skill-text") {
        registry = installSkillFromText(registry, { name: action.name, instructions: action.instructions });
      } else if (action.action === "mcp") {
        validateExtensionUrl(action.url);
        registry = installMcpServer(registry, { name: action.name, url: action.url });
      } else if (action.action === "toggle") registry = setExtensionEnabled(registry, action.id, action.enabled);
      else {
        registry = removeExtension(registry, action.id);
        if (payload.mcpToolCatalog) { payload.mcpToolCatalog = { ...payload.mcpToolCatalog }; delete payload.mcpToolCatalog[action.id]; }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, error instanceof Error ? error.message : "Invalid extension configuration.");
    }
    payload = { ...payload, extensions: registry };
    await store.saveProject(userId, projectId, record.version, payload);
    return publicProjectExtensions(payload);
  });
}
