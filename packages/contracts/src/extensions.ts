import { z } from "zod";
const identifier = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const skillSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(100),
    source: z.string().max(2000).optional(),
    instructions: z.string().min(1).max(48000),
    enabled: z.boolean(),
    files: z.record(z.string().max(200), z.string().max(48000)).optional(),
  })
  .strict();
const serverSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(100),
    url: z.string().max(2000),
    enabled: z.boolean(),
    headers: z.record(z.string().max(100), z.string().max(4000)).optional(),
  })
  .strict();
export const extensionRegistrySchema = z
  .object({
    version: z.literal(1),
    skills: z.array(skillSchema).max(20),
    servers: z.array(serverSchema).max(8),
  })
  .strict();
export type ExtensionRegistry = z.infer<typeof extensionRegistrySchema>;
export type SkillExtension = ExtensionRegistry["skills"][number];
export type McpServerExtension = ExtensionRegistry["servers"][number];
