import type { IAgentRuntime, ModelTypeName } from "@elizaos/core";
import type { LanguageModelUsage } from "ai";

const MODEL_USED_EVENT = "MODEL_USED";

export function emitModelUsageEvent(
  runtime: IAgentRuntime,
  type: ModelTypeName,
  _prompt: string,
  usage: Partial<LanguageModelUsage> & {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }
) {
  const inputTokens = Number(usage.inputTokens || 0);
  const outputTokens = Number(usage.outputTokens || 0);
  const totalTokens = Number(
    usage.totalTokens != null ? usage.totalTokens : inputTokens + outputTokens
  );

  runtime.emitEvent(MODEL_USED_EVENT, {
    runtime,
    source: "elizacloud",
    type,
    tokens: {
      prompt: inputTokens,
      completion: outputTokens,
      total: totalTokens,
    },
  });
}
