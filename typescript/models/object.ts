import type {
  IAgentRuntime,
  JsonValue,
  ObjectGenerationParams,
} from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import type { LanguageModel } from "ai";
import { generateObject, JSONParseError } from "ai";
import { createOpenAIClient } from "../providers/openai";
import { getLargeModel, getSmallModel } from "../utils/config";
import { emitModelUsageEvent } from "../utils/events";
import { getJsonRepairFunction } from "../utils/helpers";

/**
 * Models that are reasoning-class and don't support temperature.
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

async function generateObjectByModelType(
  runtime: IAgentRuntime,
  params: ObjectGenerationParams,
  modelType: string,
  getModelFn: (runtime: IAgentRuntime) => string,
): Promise<Record<string, JsonValue>> {
  const openai = createOpenAIClient(runtime);
  const modelName = getModelFn(runtime);
  logger.log(`[ELIZAOS_CLOUD] Using ${modelType} model: ${modelName}`);

  // Reasoning models don't support temperature
  const reasoning = isReasoningModel(modelName);

  try {
    // Use Chat Completions API to avoid Responses API warnings
    // about unsupported features (presencePenalty, frequencyPenalty, etc.)
    const model = openai.chat(modelName) as LanguageModel;
    const { object, usage } = await generateObject({
      model,
      output: "no-schema",
      prompt: params.prompt,
      ...(reasoning ? {} : { temperature: params.temperature ?? 0 }),
      experimental_repairText: getJsonRepairFunction(),
    });

    if (usage) {
      emitModelUsageEvent(runtime, modelType as never, params.prompt, usage);
    }
    return object as Record<string, JsonValue>;
  } catch (error) {
    if (error instanceof JSONParseError) {
      logger.error(`[generateObject] Failed to parse JSON: ${error.message}`);

      const repairFunction = getJsonRepairFunction();
      const repairedJsonString = await repairFunction({
        text: error.text,
        error,
      });

      if (repairedJsonString) {
        try {
          const repairedObject = JSON.parse(repairedJsonString);
          logger.info("[generateObject] Successfully repaired JSON.");
          return repairedObject as unknown as Record<string, JsonValue>;
        } catch (repairParseError) {
          const message =
            repairParseError instanceof Error
              ? repairParseError.message
              : String(repairParseError);
          logger.error(
            `[generateObject] Failed to parse repaired JSON: ${message}`,
          );
          throw repairParseError;
        }
      } else {
        logger.error("[generateObject] JSON repair failed.");
        throw error;
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[generateObject] Error: ${message}`);
      throw error;
    }
  }
}

export async function handleObjectSmall(
  runtime: IAgentRuntime,
  params: ObjectGenerationParams,
): Promise<Record<string, JsonValue>> {
  return generateObjectByModelType(
    runtime,
    params,
    ModelType.OBJECT_SMALL,
    getSmallModel,
  );
}

export async function handleObjectLarge(
  runtime: IAgentRuntime,
  params: ObjectGenerationParams,
): Promise<Record<string, JsonValue>> {
  return generateObjectByModelType(
    runtime,
    params,
    ModelType.OBJECT_LARGE,
    getLargeModel,
  );
}
