/** Created before resolving the composer, so Stop also owns a not-yet-started turn. */
export function createVoiceTurnGuard() {
  const controller = new AbortController();
  return {
    controller,
    cancel() { controller.abort(); },
    assertActive() { controller.signal.throwIfAborted(); },
  };
}
