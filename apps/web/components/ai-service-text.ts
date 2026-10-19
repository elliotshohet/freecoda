type ServiceOption = { id: string; name: string };

/** Presentation only; provider identifiers remain intact in requests and diagnostics. */
export function aiServiceText(value: string, options: readonly ServiceOption[] = []): string {
  let text = value;
  const identifiers = [...new Set(options.flatMap(option => [option.id, option.name]))]
    .filter(identifier => identifier.length > 2).sort((a, b) => b.length - a.length);
  for (const identifier of identifiers) {
    const needle = identifier.toLowerCase();
    let cursor = 0;
    let next = "";
    for (let match = text.toLowerCase().indexOf(needle); match >= 0; match = text.toLowerCase().indexOf(needle, cursor)) {
      next += text.slice(cursor, match) + "AI service";
      cursor = match + identifier.length;
    }
    text = next + text.slice(cursor);
  }
  return text.replace(/\b(?:reflection[\s/:-]*)?beam[\s_-]*free\b/gi, "AI service")
    .replace(/\b(?:Vercel AI Gateway|OpenAI|Anthropic|DeepSeek|Gemini|Qwen|Mistral|Grok|Kimi)\b/gi, "AI service")
    .replace(/\bmodels?\b/gi, "AI service");
}
