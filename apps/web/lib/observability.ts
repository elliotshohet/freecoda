/** Log classifications only: error messages/stacks can contain provider bodies or credentials. */
export function failureCategory(error: unknown) {
  const code =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  if (typeof code !== "string") return "internal";
  if (/^(?:08[A-Z0-9]{3}|ECONNRESET|ECONNREFUSED|ENOTFOUND|EPIPE)$/.test(code))
    return "database_connection";
  if (/^(?:53[A-Z0-9]{3}|57[A-Z0-9]{3}|ETIMEDOUT)$/.test(code))
    return "resource_or_timeout";
  if (/^23[A-Z0-9]{3}$/.test(code)) return "database_constraint";
  return "internal";
}
