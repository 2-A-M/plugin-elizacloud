import type {
  GenerateTextParams,
  IAgentRuntime,
  ModelTypeName,
  TextStreamResult,
} from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import type { LanguageModel } from "ai";
import { generateText, streamText } from "ai";
import { createOpenAIClient } from "../providers/openai";
import {
  getExperimentalTelemetry,
  getLargeModel,
  getReasoningLargeModel,
  getReasoningSmallModel,
  getSmallModel,
} from "../utils/config";
import { emitModelUsageEvent } from "../utils/events";

/**
 * Models that are known to be reasoning-class and don't support temperature.
 * These are models that use chain-of-thought internally and reject
 */
const REASONING_MODEL_PATTERNS = [
  "o1", "o3", "o4", "deepseek-r1", "deepseek-reasoner",
  "claude-opus-4.5", "claude-opus-4",
  "gpt-5-mini", "gpt-5",
] as const;

function isReasoningModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return REASONING_MODEL_PATTERNS.some((pattern) => lower.includes(pattern));
}

type TextModelType =
  | typeof ModelType.TEXT_SMALL
  | typeof ModelType.TEXT_LARGE
  | typeof ModelType.TEXT_REASONING_SMALL
  | typeof ModelType.TEXT_REASONING_LARGE;

function getModelNameForType(runtime: IAgentRuntime, modelType: TextModelType): string {
  switch (modelType) {
    case ModelType.TEXT_SMALL:
      return getSmallModel(runtime);
    case ModelType.TEXT_LARGE:
      return getLargeModel(runtime);
    case ModelType.TEXT_REASONING_SMALL:
      return getReasoningSmallModel(runtime);
    case ModelType.TEXT_REASONING_LARGE:
      return getReasoningLargeModel(runtime);
    default:
      return getLargeModel(runtime);
  }
}

function buildGenerateParams(
  runtime: IAgentRuntime,
  modelType: TextModelType,
  params: GenerateTextParams,
) {
  const { prompt, stopSequences = [] } = params;
  const maxTokens = params.maxTokens ?? 8192;

  const openai = createOpenAIClient(runtime);
  const modelName = getModelNameForType(runtime, modelType);
  const experimentalTelemetry = getExperimentalTelemetry(runtime);

  // Use openai.chat() (Chat Completions API) instead of openai.languageModel()
  // (Responses API). The Responses API unconditionally rejects presencePenalty,
  // frequencyPenalty, and stopSequences for ALL models, emitting noisy warnings.
  // The Chat Completions API supports these features natively and handles
  // reasoning models gracefully when the params are omitted.
  const model = openai.chat(modelName) as LanguageModel;

  // Reasoning models don't support temperature, frequency/presence penalties,
  // or stopSequences. Detect via model name patterns OR explicit reasoning model types.
  const reasoning =
    isReasoningModel(modelName) ||
    modelType === ModelType.TEXT_REASONING_SMALL ||
    modelType === ModelType.TEXT_REASONING_LARGE;

  const generateParams = {
    model,
    prompt: prompt,
    system: runtime.character.system ?? undefined,
    ...(reasoning ? {} : {
      stopSequences: stopSequences,
    }),
    maxOutputTokens: maxTokens,
    experimental_telemetry: {
      isEnabled: experimentalTelemetry,
    },
  };

  return { generateParams, modelName, modelType, prompt };
}

function handleStreamingGeneration(
  runtime: IAgentRuntime,
  modelType: ModelTypeName,
  generateParams: Parameters<typeof streamText>[0],
  prompt: string,
): TextStreamResult {
  logger.debug(`[ELIZAOS_CLOUD] Streaming text with ${modelType} model`);

  const streamResult = streamText(generateParams);

  return {
    textStream: streamResult.textStream,
    text: Promise.resolve(streamResult.text),
    usage: Promise.resolve(streamResult.usage).then((usage) => {
      if (usage) {
        emitModelUsageEvent(runtime, modelType, prompt, usage);
        const inputTokens = usage.inputTokens ?? 0;
        const outputTokens = usage.outputTokens ?? 0;
        return {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
        };
      }
      return undefined;
    }),
    finishReason: Promise.resolve(streamResult.finishReason) as Promise<
      string | undefined
    >,
  };
}

async function generateTextWithModel(
  runtime: IAgentRuntime,
  modelType: TextModelType,
  params: GenerateTextParams,
): Promise<string | TextStreamResult> {
  const { generateParams, modelName, prompt } = buildGenerateParams(
    runtime,
    modelType,
    params,
  );

  logger.debug(
    `[ELIZAOS_CLOUD] Generating text with ${modelType} model: ${modelName}`,
  );

  if (params.stream) {
    return handleStreamingGeneration(
      runtime,
      modelType,
      generateParams,
      prompt,
    );
  }

  logger.log(`[ELIZAOS_CLOUD] Using ${modelType} model: ${modelName}`);
  logger.log(prompt);

  const response = await generateText(generateParams);

  if (response.usage) {
    emitModelUsageEvent(runtime, modelType, prompt, response.usage);
  }

  return response.text;
}

export async function handleTextSmall(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, ModelType.TEXT_SMALL, params);
}

export async function handleTextLarge(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, ModelType.TEXT_LARGE, params);
}

export async function handleTextReasoningSmall(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, ModelType.TEXT_REASONING_SMALL, params);
}

export async function handleTextReasoningLarge(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, ModelType.TEXT_REASONING_LARGE, params);
}
