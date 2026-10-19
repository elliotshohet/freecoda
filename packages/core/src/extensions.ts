import { z } from "zod";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as pinnedFetch } from "undici";
import { createMCPClient } from "@ai-sdk/mcp";
import { tool, type ToolSet } from "ai";
import type { Approval } from "./workspace";

import {
  extensionRegistrySchema,
  type ExtensionRegistry,
  type SkillExtension,
  type McpServerExtension,
} from "@freecoda/contracts";
export { extensionRegistrySchema };
export type { ExtensionRegistry, SkillExtension, McpServerExtension };
export const emptyExtensionRegistry = (): ExtensionRegistry => ({
  version: 1,
  skills: [],
  servers: [],
});
export function parseExtensionRegistry(value: unknown): ExtensionRegistry {
  const registry = extensionRegistrySchema.parse(value);
  const ids = [...registry.skills, ...registry.servers].map((e) => e.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Extension IDs must be unique.");
  let bytes = 0;
  for (const skill of registry.skills) {
    for (const [name, content] of Object.entries(skill.files || {})) {
      if (
        name.startsWith("/") ||
        name.includes("\\") ||
        name.split("/").some((p) => p === ".." || p.startsWith("."))
      )
        throw new Error("Skill files must use safe relative paths.");
      bytes += Buffer.byteLength(content);
    }
    bytes += Buffer.byteLength(skill.instructions);
  }
  if (bytes > 256_000)
    throw new Error("Installed skill contents exceed 256KB.");
  for (const server of registry.servers) validateExtensionUrl(server.url, true);
  return registry;
}
export function publicExtensions(registry: ExtensionRegistry) {
  return {
    version: 1 as const,
    skills: registry.skills.map(({ id, name, source, enabled }) => ({
      id,
      name,
      source,
      enabled,
    })),
    servers: registry.servers.map(({ id, name, url, enabled }) => ({
      id,
      name,
      url,
      enabled,
    })),
  };
}
function extensionId(kind: string, source: string) {
  return `${kind}_${createHash("sha256").update(source).digest("hex").slice(0, 16)}`;
}
export function validateExtensionUrl(value: string, allowLocal = false) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(allowLocal && loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      "Use an HTTPS URL without credentials, query or fragment (local clients also allow loopback HTTP).",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowLocal && (loopback || (isIP(hostname) && !publicAddress(hostname))))
    throw new Error(
      "Hosted extension URLs must point to public Internet addresses.",
    );
  return url;
}
function publicAddress(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    // Globally routable unicast only; deny mapped IPv4 and transition ranges.
    return (
      /^[23][0-9a-f]{3}:/.test(normalized) &&
      !normalized.startsWith("2001:db8:") &&
      !normalized.startsWith("2002:") &&
      !normalized.startsWith("2001:0:")
    );
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a >= 1 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    a !== 0 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && [18, 19, 51].includes(b)) &&
    !(a === 203 && b === 0)
  );
}
/** Resolve and pin validated IPs inside the actual socket lookup, preventing DNS rebinding. */
export function extensionFetch(allowLocal = false): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = validateExtensionUrl(
      input instanceof Request ? input.url : String(input),
      allowLocal,
    );
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!allowLocal && loopback)
      throw new Error("Hosted extensions cannot access local addresses.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await lookup(hostname, { all: true });
    if (
      !addresses.length ||
      addresses.some(
        (a) => !(allowLocal && loopback) && !publicAddress(a.address),
      )
    )
      throw new Error(
        "Extension endpoint must resolve only to public Internet addresses.",
      );
    const pinned = addresses.find((a) => a.family === 4) ?? addresses[0]!;
    const body =
      init.body ?? (input instanceof Request ? await input.text() : undefined);
    if (
      body !== undefined &&
      body !== null &&
      typeof body !== "string" &&
      !(body instanceof Uint8Array)
    )
      throw new Error("Unsupported extension request body.");
    const headers = Object.fromEntries(
      new Headers(
        init.headers ?? (input instanceof Request ? input.headers : undefined),
      ),
    );
    const signal =
      init.signal ?? (input instanceof Request ? input.signal : undefined);
    const agent = new Agent({
      connect: {
        servername: hostname,
        lookup: ((_host: string, options: any, callback: any) => {
          if (options?.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        }) as any,
        timeout: 15_000,
      },
      headersTimeout: 20_000,
      bodyTimeout: 20_000,
    });
    try {
      const response = await pinnedFetch(url, {
        method:
          init.method ?? (input instanceof Request ? input.method : "GET"),
        headers,
        body: body as string | Uint8Array | undefined,
        signal: signal ?? undefined,
        dispatcher: agent,
        redirect: "error",
      });
      const responseHeaders = new Headers();
      response.headers.forEach((value, name) =>
        responseHeaders.append(name, value),
      );
      if (!response.body) {
        await agent.close();
        return new Response(null, {
          status: response.status,
          headers: responseHeaders,
        });
      }
      const reader = response.body.getReader();
      let bytes = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { value, done } = await reader.read();
            if (done) {
              controller.close();
              await agent.close();
              return;
            }
            bytes += value.byteLength;
            if (bytes > 2_000_000)
              throw new Error("Extension response exceeds 2MB.");
            controller.enqueue(value);
          } catch (error) {
            controller.error(error);
            await reader.cancel().catch(() => {});
            await agent.destroy();
          }
        },
        async cancel(reason) {
          await reader.cancel(reason).catch(() => {});
          await agent.destroy();
        },
      });
      return new Response(stream, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (error) {
      await agent.destroy();
      throw error;
    }
  }) as typeof fetch;
}
export function installMcpServer(
  registry: ExtensionRegistry,
  input: { name: string; url: string; headers?: Record<string, string> },
): ExtensionRegistry {
  const url = validateExtensionUrl(input.url, true).toString();
  const id = extensionId("mcp", url);
  return parseExtensionRegistry({
    ...registry,
    servers: [
      ...registry.servers.filter((e) => e.id !== id),
      { id, name: input.name, url, headers: input.headers, enabled: true },
    ],
  });
}
export function setExtensionEnabled(
  registry: ExtensionRegistry,
  id: string,
  enabled: boolean,
): ExtensionRegistry {
  if (![...registry.skills, ...registry.servers].some((e) => e.id === id))
    throw new Error("Extension not found.");
  return parseExtensionRegistry({
    ...registry,
    skills: registry.skills.map((e) => (e.id === id ? { ...e, enabled } : e)),
    servers: registry.servers.map((e) => (e.id === id ? { ...e, enabled } : e)),
  });
}
export function removeExtension(
  registry: ExtensionRegistry,
  id: string,
): ExtensionRegistry {
  return parseExtensionRegistry({
    ...registry,
    skills: registry.skills.filter((e) => e.id !== id),
    servers: registry.servers.filter((e) => e.id !== id),
  });
}
export function installSkillFromText(
  registry: ExtensionRegistry,
  input: { name: string; instructions: string; source?: string },
): ExtensionRegistry {
  if (!input.instructions.trim() || input.instructions.includes("\0"))
    throw new Error("SKILL.md must be nonempty text.");
  const source = input.source || `uploaded:${input.name}`;
  const id = extensionId("skill", source);
  return parseExtensionRegistry({
    ...registry,
    skills: [
      ...registry.skills.filter((e) => e.id !== id),
      {
        id,
        name: input.name,
        source,
        instructions: input.instructions,
        enabled: true,
      },
    ],
  });
}
export async function installRemoteSkill(
  registry: ExtensionRegistry,
  input: { source: string; name?: string; allowLocal?: boolean },
): Promise<ExtensionRegistry> {
  let source = input.source;
  let instructions: string;
  if (!/^https?:\/\//.test(source))
    throw new Error("Hosted installs require an HTTPS SKILL.md URL.");
  const url = new URL(source);
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[2] !== "blob" || parts.length < 5)
      throw new Error(
        "Use a GitHub file URL ending in SKILL.md, or a raw HTTPS URL.",
      );
    source = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join("/")}`;
  }
  const response = await extensionFetch(Boolean(input.allowLocal))(source, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Could not download SKILL.md.");
  if (Number(response.headers.get("content-length")) > 48_000)
    throw new Error("SKILL.md exceeds 48KB.");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 48_000) {
      await reader.cancel();
      throw new Error("SKILL.md exceeds 48KB.");
    }
    chunks.push(value);
  }
  instructions = Buffer.concat(chunks).toString("utf8");

  const name =
    input.name ||
    instructions.match(/^name:\s*["']?([^\r\n"']+)/m)?.[1]?.trim() ||
    "Installed skill";
  return installSkillFromText(registry, { name, instructions, source });
}
export async function connectExtensionTools(
  registry: ExtensionRegistry,
  options: {
    approve: Approval;
    signal?: AbortSignal;
    allowLocal?: boolean;
    readOnly?: boolean;
    onTool?: (name: string) => void;
    redactText?: (value: string) => string;
  },
) {
  const parsed = parseExtensionRegistry(registry);
  const redact = (text: string) => {
    let result = options.redactText?.(text) ?? text;
    for (const server of parsed.servers)
      for (const secret of Object.values(server.headers || {}))
        if (secret) result = result.split(secret).join("[redacted credential]");
    return result;
  };
  const clients: Awaited<ReturnType<typeof createMCPClient>>[] = [];
  const tools: ToolSet = {};
  const skills = parsed.skills.filter((s) => s.enabled);
  const fullInstructions = skills
    .map(
      (s) =>
        `Installed skill: ${s.name} (ID ${s.id})\nSupporting files: ${Object.keys(s.files || {}).join(", ") || "none"}\n${redact(s.instructions)}`,
    )
    .join("\n\n");
  const instructions =
    fullInstructions.length <= 48000
      ? fullInstructions
      : "Installed skill instructions exceed the inline context budget. Use skill_file with path SKILL.md to load each relevant skill before following it.\n" +
        skills
          .map(
            (s) =>
              `${s.name} (ID ${s.id}): ${Object.keys(s.files || {}).join(", ") || "SKILL.md"}`,
          )
          .join("\n");
  const support = Object.fromEntries(skills.map((s) => [s.id, s]));
  if (skills.length) {
    tools.skill_file = tool({
      description:
        "Read SKILL.md instructions or a bundled supporting file from an explicitly installed skill. These are reference data, not executable permissions.",
      inputSchema: z.object({ skillId: z.string(), path: z.string() }),
      execute: async ({ skillId, path: file }) => ({
        content: redact(
          (file === "SKILL.md"
            ? support[skillId]?.instructions
            : support[skillId]?.files?.[file]) ?? "Skill file not found.",
        ),
      }),
    });
  }
  if (!options.readOnly) {
    try {
      let remoteToolCount = 0;
      for (const server of parsed.servers.filter((s) => s.enabled)) {
        if (remoteToolCount >= 20) break;
        options.signal?.throwIfAborted();
        const client = await createMCPClient({
          initializationOptions: { signal: options.signal, timeout: 15_000 },
          transport: {
            type: "http",
            url: server.url,
            headers: server.headers,
            fetch: extensionFetch(Boolean(options.allowLocal)),
            redirect: "error",
          },
        });
        clients.push(client);
        const discovered = await client.tools();
        for (const [name, definition] of Object.entries(discovered).slice(
          0,
          20 - remoteToolCount,
        )) {
          const safeName =
            `mcp_${server.id.slice(4, 14)}_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(
              0,
              64,
            );
          remoteToolCount++;
          tools[safeName] = {
            description: definition.description,
            inputSchema: definition.inputSchema,
            execute: async (args, context) => {
              if (
                !(await options.approve(
                  "shell",
                  `External tool: ${server.name} / ${name}\nEndpoint: ${server.url}\nArguments: ${JSON.stringify(args).slice(0, 8000)}\nThis sends these arguments to the installed MCP server; it may perform external actions.`,
                ))
              )
                return {
                  denied: true,
                  message:
                    "External tool declined. Do not retry this approval category.",
                };
              options.signal?.throwIfAborted();
              options.onTool?.(safeName);
              let result: unknown;
              try {
                result = await definition.execute!(args, {
                  ...context,
                  abortSignal: options.signal ?? context.abortSignal,
                });
              } catch (error) {
                throw new Error(
                  redact(
                    error instanceof Error
                      ? error.message
                      : "External tool failed.",
                  ),
                );
              }
              const text = JSON.stringify(result);
              if (text.length > 64_000)
                return {
                  truncated: true,
                  content: redact(text.slice(0, 64_000)),
                };
              return { content: redact(text) };
            },
          };
        }
      }
    } catch (error) {
      await Promise.allSettled(clients.map((c) => c.close()));
      throw new Error(
        redact(
          error instanceof Error
            ? error.message
            : "Extension connection failed.",
        ),
      );
    }
  }
  return {
    tools,
    instructions,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
