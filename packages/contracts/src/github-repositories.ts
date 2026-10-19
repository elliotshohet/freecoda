import { z } from "zod";

const component = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);
export const githubRepositorySettingSchema = z.object({
  repositoryId: z.number().int().positive().safe(),
  installationId: z.number().int().positive().safe(),
  owner: component,
  name: component,
  branch: z.string().min(1).max(255).refine(value => !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.includes("..") && !value.startsWith("-") && !value.endsWith("/") && !value.endsWith(".lock")),
  appDirectory: z.string().max(300).default("").refine(value => value === "" || (value.split("/").every(part => part !== "" && part !== "." && part !== "..") && !/[\\\x00-\x1f\x7f]/.test(value))),
  enabled: z.boolean().default(true),
}).strict();
export type GithubRepositorySetting = z.infer<typeof githubRepositorySettingSchema>;
export const githubRepositorySettingsSchema = z.object({ repositories: z.array(githubRepositorySettingSchema).max(50) }).strict();
