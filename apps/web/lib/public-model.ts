import type { ModelConfig } from "@freecoda/contracts";
/** Only catalog fields required by clients may cross the public API boundary. */
export function publicModelConfig(config: ModelConfig): ModelConfig {
  return {
    id: config.id,
    provider: config.provider,
    ...(config.byok === undefined ? {} : { byok: config.byok }),
    ...(config.allowPromptTraining === undefined ? {} : { allowPromptTraining: config.allowPromptTraining }),
    inputMicrosPerToken: config.inputMicrosPerToken,
    outputMicrosPerToken: config.outputMicrosPerToken,
    maxContextTokens: config.maxContextTokens,
    approved: config.approved,
  };
}
