import type { ModelConfig } from "@freecoda/contracts";
export function approvedFreeModels(models: ModelConfig[]): ModelConfig[] {
  return models.filter((model) => model.id === "reflection/beam-free" && model.provider === "reflection" && model.approved === true && model.byok === false && model.inputMicrosPerToken === 0 && model.outputMicrosPerToken === 0);
}
