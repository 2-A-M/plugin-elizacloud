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
  getActionPlannerModel,
  getExperimentalTelemetry,
  getLargeModel,
  getMegaModel,
  getMiniModel,
  getNanoModel,
  getReasoningLargeModel,
  getReasoningSmallModel,
  getResponseHandlerModel,
  getSmallModel,
} from "../utils/config";
import { emitModelUsageEvent } from "../utils/events";

const TEXT_NANO_MODEL_TYPE = (ModelType.TEXT_NANO ?? "TEXT_NANO") as ModelTypeName;
const TEXT_MINI_MODEL_TYPE = (ModelType.TEXT_MINI ?? "TEXT_MINI") as ModelTypeName;
const TEXT_SMALL_MODEL_TYPE = ModelType.TEXT_SMALL;
const TEXT_LARGE_MODEL_TYPE = ModelType.TEXT_LARGE;
const TEXT_MEGA_MODEL_TYPE = (ModelType.TEXT_MEGA ?? "TEXT_MEGA") as ModelTypeName;
const RESPONSE_HANDLER_MODEL_TYPE = (ModelType.RESPONSE_HANDLER ??
  "RESPONSE_HANDLER") as ModelTypeName;
const ACTION_PLANNER_MODEL_TYPE = (ModelType.ACTION_PLANNER ??
  "ACTION_PLANNER") as ModelTypeName;
const TEXT_REASONING_SMALL_MODEL_TYPE = ModelType.TEXT_REASONING_SMALL;
const TEXT_REASONING_LARGE_MODEL_TYPE = ModelType.TEXT_REASONING_LARGE;

/**
 * Models that are known to be reasoning-class and don't support temperature.
 * These are models that use chain-of-thought internally and reject
 */
const REASONING_MODEL_PATTERNS = [
  "o1",
  "o3",
  "o4",
  "deepseek-r1",
  "deepseek-reasoner",
  "claude-opus-4.5",
  "claude-opus-4",
  "gpt-5-mini",
  "gpt-5",
] as const;
const RESPONSES_ROUTED_PREFIXES = ["openai/", "anthropic/"] as const;
type ChatAttachment = {
  data: string | Uint8Array | URL;
  mediaType: string;
  filename?: string;
};

type GenerateTextParamsWithAttachments = GenerateTextParams & {
  attachments?: ChatAttachment[];
};

function buildUserContent(params: GenerateTextParamsWithAttachments) {
  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "file";
        data: string | Uint8Array | URL;
        mediaType: string;
        filename?: string;
      }
  > = [{ type: "text", text: params.prompt }];

  for (const attachment of params.attachments ?? []) {
    content.push({
      type: "file",
      data: attachment.data,
      mediaType: attachment.mediaType,
      ...(attachment.filename ? { filename: attachment.filename } : {}),
    });
  }

  return content;
}

function isReasoningModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return REASONING_MODEL_PATTERNS.some((pattern) => lower.includes(pattern));
}

function supportsStopSequences(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return !RESPONSES_ROUTED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

type TextModelType =
  | typeof TEXT_NANO_MODEL_TYPE
  | typeof TEXT_MINI_MODEL_TYPE
  | typeof TEXT_SMALL_MODEL_TYPE
  | typeof TEXT_LARGE_MODEL_TYPE
  | typeof TEXT_MEGA_MODEL_TYPE
  | typeof RESPONSE_HANDLER_MODEL_TYPE
  | typeof ACTION_PLANNER_MODEL_TYPE
  | typeof TEXT_REASONING_SMALL_MODEL_TYPE
  | typeof TEXT_REASONING_LARGE_MODEL_TYPE;

function getModelNameForType(runtime: IAgentRuntime, modelType: TextModelType): string {
  switch (modelType) {
    case TEXT_NANO_MODEL_TYPE:
      return getNanoModel(runtime);
    case TEXT_MINI_MODEL_TYPE:
      return getMiniModel(runtime);
    case TEXT_SMALL_MODEL_TYPE:
      return getSmallModel(runtime);
    case TEXT_LARGE_MODEL_TYPE:
      return getLargeModel(runtime);
    case TEXT_MEGA_MODEL_TYPE:
      return getMegaModel(runtime);
    case RESPONSE_HANDLER_MODEL_TYPE:
      return getResponseHandlerModel(runtime);
    case ACTION_PLANNER_MODEL_TYPE:
      return getActionPlannerModel(runtime);
    case TEXT_REASONING_SMALL_MODEL_TYPE:
      return getReasoningSmallModel(runtime);
    case TEXT_REASONING_LARGE_MODEL_TYPE:
      return getReasoningLargeModel(runtime);
    default:
      return getLargeModel(runtime);
  }
}

function buildGenerateParams(
  runtime: IAgentRuntime,
  modelType: TextModelType,
  params: GenerateTextParams
) {
  const paramsWithAttachments = params as GenerateTextParamsWithAttachments;
  const { prompt } = params;
  const maxTokens = params.maxTokens ?? 8192;

  const openai = createOpenAIClient(runtime);
  const modelName = getModelNameForType(runtime, modelType);
  const experimentalTelemetry = getExperimentalTelemetry(runtime);
  const userContent =
    (paramsWithAttachments.attachments?.length ?? 0) > 0
      ? buildUserContent(paramsWithAttachments)
      : undefined;

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
    modelType === TEXT_REASONING_SMALL_MODEL_TYPE ||
    modelType === TEXT_REASONING_LARGE_MODEL_TYPE;
  const stopSequences =
    !reasoning &&
    supportsStopSequences(modelName) &&
    Array.isArray(params.stopSequences) &&
    params.stopSequences.length > 0
      ? params.stopSequences
      : undefined;

  const generateParams = {
    model,
    ...(userContent
      ? { messages: [{ role: "user" as const, content: userContent }] }
      : { prompt: prompt }),
    system: runtime.character.system ?? undefined,
    ...(stopSequences ? { stopSequences } : {}),
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
  prompt: string
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
    finishReason: Promise.resolve(streamResult.finishReason) as Promise<string | undefined>,
  };
}

async function generateTextWithModel(
  runtime: IAgentRuntime,
  modelType: TextModelType,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  const { generateParams, modelName, prompt } = buildGenerateParams(runtime, modelType, params);

  logger.debug(`[ELIZAOS_CLOUD] Generating text with ${modelType} model: ${modelName}`);

  if (params.stream) {
    return handleStreamingGeneration(runtime, modelType, generateParams, prompt);
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
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, TEXT_SMALL_MODEL_TYPE, params);
}

export async function handleTextNano(
  runtime: IAgentRuntime,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, TEXT_NANO_MODEL_TYPE, params);
}

export async function handleTextMini(
  runtime: IAgentRuntime,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, TEXT_MINI_MODEL_TYPE, params);
}

export async function handleTextLarge(
  runtime: IAgentRuntime,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, TEXT_LARGE_MODEL_TYPE, params);
}

export async function handleTextMega(
  runtime: IAgentRuntime,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, TEXT_MEGA_MODEL_TYPE, params);
}

export async function handleResponseHandler(
  runtime: IAgentRuntime,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, RESPONSE_HANDLER_MODEL_TYPE, params);
}

export async function handleActionPlanner(
  runtime: IAgentRuntime,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, ACTION_PLANNER_MODEL_TYPE, params);
}

export async function handleTextReasoningSmall(
  runtime: IAgentRuntime,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, TEXT_REASONING_SMALL_MODEL_TYPE, params);
}

export async function handleTextReasoningLarge(
  runtime: IAgentRuntime,
  params: GenerateTextParams
): Promise<string | TextStreamResult> {
  return generateTextWithModel(runtime, TEXT_REASONING_LARGE_MODEL_TYPE, params);
}
