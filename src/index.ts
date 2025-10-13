import { createOpenAI } from '@ai-sdk/openai';
import type {
  DetokenizeTextParams,
  GenerateTextParams,
  IAgentRuntime,
  ImageDescriptionParams,
  ModelTypeName,
  ObjectGenerationParams,
  Plugin,
  TextEmbeddingParams,
  TokenizeTextParams,
} from '@elizaos/core';
import { EventType, logger, ModelType, VECTOR_DIMS } from '@elizaos/core';
import {
  generateObject,
  generateText,
  JSONParseError,
  type JSONValue,
  type LanguageModelUsage,
} from 'ai';
import { encodingForModel, type TiktokenModel } from 'js-tiktoken';

export interface OpenAITranscriptionParams {
  audio: Blob | File | Buffer;
  model?: string;
  language?: string;
  response_format?: string;
  prompt?: string;
  temperature?: number;
  timestampGranularities?: string[];
  mimeType?: string; // MIME type for Buffer audio data (e.g., 'audio/wav', 'audio/mp3', 'audio/webm')
}

export interface OpenAITextToSpeechParams {
  text: string;
  model?: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'flac' | string;
  instructions?: string;
}

/**
 * Retrieves a configuration setting from the runtime, falling back to environment variables or a default value if not found.
 *
 * @param key - The name of the setting to retrieve.
 * @param defaultValue - The value to return if the setting is not found in the runtime or environment.
 * @returns The resolved setting value, or {@link defaultValue} if not found.
 */
function getSetting(
  runtime: IAgentRuntime,
  key: string,
  defaultValue?: string
): string | undefined {
  return runtime.getSetting(key) ?? process.env[key] ?? defaultValue;
}

function isBrowser(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as any).document !== 'undefined';
}

/**
 * Determines whether we're running in a browser with a server-hosted proxy configured.
 * In this mode, we do not require a real API key on the client and rely on the proxy to inject it.
 */
function isProxyMode(runtime: IAgentRuntime): boolean {
  return isBrowser() && !!getSetting(runtime, 'ELIZAOS_BROWSER_BASE_URL');
}

function getAuthHeader(runtime: IAgentRuntime, forEmbedding = false): Record<string, string> {
  if (isBrowser()) return {};
  const key = forEmbedding ? getEmbeddingApiKey(runtime) : getApiKey(runtime);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * Retrieves the OpenAI API base URL from runtime settings, environment variables, or defaults, using provider-aware resolution.
 *
 * @returns The resolved base URL for OpenAI API requests.
 */
function getBaseURL(runtime: IAgentRuntime): string {
  const browserURL = getSetting(runtime, 'ELIZAOS_BROWSER_BASE_URL');
  const baseURL = (
    isBrowser() && browserURL
      ? browserURL
      : getSetting(runtime, 'ELIZAOS_BASE_URL', 'https://api.openai.com/v1')
  ) as string;
  logger.debug(`[ELIZAOS_CLOUD] Default base URL: ${baseURL}`);
  return baseURL;
}

/**
 * Retrieves the OpenAI API base URL for embeddings, falling back to the general base URL.
 *
 * @returns The resolved base URL for OpenAI embedding requests.
 */
function getEmbeddingBaseURL(runtime: IAgentRuntime): string {
  const embeddingURL = isBrowser()
    ? getSetting(runtime, 'ELIZAOS_BROWSER_EMBEDDING_URL') ||
      getSetting(runtime, 'ELIZAOS_BROWSER_BASE_URL')
    : getSetting(runtime, 'ELIZAOS_EMBEDDING_URL');
  if (embeddingURL) {
    logger.debug(`[ELIZAOS_CLOUD] Using specific embedding base URL: ${embeddingURL}`);
    return embeddingURL;
  }
  logger.debug('[ELIZAOS_CLOUD] Falling back to general base URL for embeddings.');
  return getBaseURL(runtime);
}

/**
 * Helper function to get the API key for OpenAI
 *
 * @param runtime The runtime context
 * @returns The configured API key
 */
function getApiKey(runtime: IAgentRuntime): string | undefined {
  return getSetting(runtime, 'ELIZAOS_API_KEY');
}

/**
 * Helper function to get the embedding API key for OpenAI, falling back to the general API key if not set.
 *
 * @param runtime The runtime context
 * @returns The configured API key
 */
function getEmbeddingApiKey(runtime: IAgentRuntime): string | undefined {
  const embeddingApiKey = getSetting(runtime, 'ELIZAOS_EMBEDDING_API_KEY');
  if (embeddingApiKey) {
    logger.debug('[ELIZAOS_CLOUD] Using specific embedding API key (present)');
    return embeddingApiKey;
  }
  logger.debug('[ELIZAOS_CLOUD] Falling back to general API key for embeddings.');
  return getApiKey(runtime);
}

/**
 * Helper function to get the small model name with fallbacks
 *
 * @param runtime The runtime context
 * @returns The configured small model name
 */
function getSmallModel(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, 'ELIZAOS_SMALL_MODEL') ??
    (getSetting(runtime, 'SMALL_MODEL', 'gpt-5-nano') as string)
  );
}

/**
 * Helper function to get the large model name with fallbacks
 *
 * @param runtime The runtime context
 * @returns The configured large model name
 */
function getLargeModel(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, 'ELIZAOS_LARGE_MODEL') ??
    (getSetting(runtime, 'LARGE_MODEL', 'gpt-5-mini') as string)
  );
}

/**
 * Helper function to get the image description model name with fallbacks
 *
 * @param runtime The runtime context
 * @returns The configured image description model name
 */
function getImageDescriptionModel(runtime: IAgentRuntime): string {
  return getSetting(runtime, 'ELIZAOS_IMAGE_DESCRIPTION_MODEL', 'gpt-5-nano') ?? 'gpt-5-nano';
}

/**
 * Helper function to get experimental telemetry setting
 *
 * @param runtime The runtime context
 * @returns Whether experimental telemetry is enabled
 */
function getExperimentalTelemetry(runtime: IAgentRuntime): boolean {
  const setting = getSetting(runtime, 'ELIZAOS_EXPERIMENTAL_TELEMETRY', 'false');
  // Convert to string and check for truthy values
  const normalizedSetting = String(setting).toLowerCase();
  const result = normalizedSetting === 'true';
  logger.debug(
    `[ELIZAOS_CLOUD] Experimental telemetry in function: "${setting}" (type: ${typeof setting}, normalized: "${normalizedSetting}", result: ${result})`
  );
  return result;
}

/**
 * Create an OpenAI client with proper configuration
 *
 * @param runtime The runtime context
 * @returns Configured OpenAI client
 */
function createOpenAIClient(runtime: IAgentRuntime) {
  const baseURL = getBaseURL(runtime);
  // In proxy mode (browser + proxy base URL), pass a harmless placeholder key.
  // The server proxy replaces Authorization; no secrets leave the server.
  const apiKey = getApiKey(runtime) ?? (isProxyMode(runtime) ? 'sk-proxy' : undefined);
  return createOpenAI({ apiKey: (apiKey ?? '') as string, baseURL });
}

/**
 * Asynchronously tokenizes the given text based on the specified model and prompt.
 *
 * @param {ModelTypeName} model - The type of model to use for tokenization.
 * @param {string} prompt - The text prompt to tokenize.
 * @returns {number[]} - An array of tokens representing the encoded prompt.
 */
async function tokenizeText(model: ModelTypeName, prompt: string) {
  const modelName =
    model === ModelType.TEXT_SMALL
      ? (process.env.ELIZAOS_SMALL_MODEL ?? process.env.SMALL_MODEL ?? 'gpt-5-nano')
      : (process.env.LARGE_MODEL ?? 'gpt-5-mini');
  const tokens = encodingForModel(modelName as TiktokenModel).encode(prompt);
  return tokens;
}

/**
 * Detokenize a sequence of tokens back into text using the specified model.
 *
 * @param {ModelTypeName} model - The type of model to use for detokenization.
 * @param {number[]} tokens - The sequence of tokens to detokenize.
 * @returns {string} The detokenized text.
 */
async function detokenizeText(model: ModelTypeName, tokens: number[]) {
  const modelName =
    model === ModelType.TEXT_SMALL
      ? (process.env.ELIZAOS_SMALL_MODEL ?? process.env.SMALL_MODEL ?? 'gpt-5-nano')
      : (process.env.ELIZAOS_LARGE_MODEL ?? process.env.LARGE_MODEL ?? 'gpt-5-mini');
  return encodingForModel(modelName as TiktokenModel).decode(tokens);
}

/**
 * Helper function to generate objects using specified model type
 */
async function generateObjectByModelType(
  runtime: IAgentRuntime,
  params: ObjectGenerationParams,
  modelType: string,
  getModelFn: (runtime: IAgentRuntime) => string
): Promise<JSONValue> {
  const openai = createOpenAIClient(runtime);
  const modelName = getModelFn(runtime);
  logger.log(`[ELIZAOS_CLOUD] Using ${modelType} model: ${modelName}`);
  const temperature = params.temperature ?? 0;
  const schemaPresent = !!params.schema;

  if (schemaPresent) {
    logger.info(
      `Using ${modelType} without schema validation (schema provided but output=no-schema)`
    );
  }

  try {
    const { object, usage } = await generateObject({
      model: openai.languageModel(modelName),
      output: 'no-schema',
      prompt: params.prompt,
      temperature: temperature,
      experimental_repairText: getJsonRepairFunction(),
    });

    if (usage) {
      emitModelUsageEvent(runtime, modelType as ModelTypeName, params.prompt, usage);
    }
    return object;
  } catch (error: unknown) {
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
          logger.info('[generateObject] Successfully repaired JSON.');
          return repairedObject;
        } catch (repairParseError: unknown) {
          const message =
            repairParseError instanceof Error ? repairParseError.message : String(repairParseError);
          logger.error(`[generateObject] Failed to parse repaired JSON: ${message}`);
          throw repairParseError;
        }
      } else {
        logger.error('[generateObject] JSON repair failed.');
        throw error;
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[generateObject] Unknown error: ${message}`);
      throw error;
    }
  }
}

/**
 * Returns a function to repair JSON text
 */
function getJsonRepairFunction(): (params: {
  text: string;
  error: unknown;
}) => Promise<string | null> {
  return async ({ text, error }: { text: string; error: unknown }) => {
    try {
      if (error instanceof JSONParseError) {
        const cleanedText = text.replace(/```json\n|\n```|```/g, '');
        JSON.parse(cleanedText);
        return cleanedText;
      }
      return null;
    } catch (jsonError: unknown) {
      const message = jsonError instanceof Error ? jsonError.message : String(jsonError);
      logger.warn(`Failed to repair JSON text: ${message}`);
      return null;
    }
  };
}

/**
 * Emits a model usage event
 * @param runtime The runtime context
 * @param type The model type
 * @param prompt The prompt used
 * @param usage The LLM usage data
 */
function emitModelUsageEvent(
  runtime: IAgentRuntime,
  type: ModelTypeName,
  prompt: string,
  usage: LanguageModelUsage
) {
  runtime.emitEvent(EventType.MODEL_USED, {
    provider: 'openai',
    type,
    prompt,
    tokens: {
      prompt: usage.inputTokens,
      completion: usage.outputTokens,
      total: usage.totalTokens,
    },
  });
}

/**
 * Detects audio MIME type from buffer by checking magic bytes (file signature)
 * @param buffer The audio buffer to analyze
 * @returns The detected MIME type or 'application/octet-stream' if unknown
 */
function detectAudioMimeType(buffer: Buffer): string {
  if (buffer.length < 12) {
    return 'application/octet-stream';
  }

  // Check magic bytes for common audio formats
  // WAV: "RIFF" + size + "WAVE"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  ) {
    return 'audio/wav';
  }

  // MP3: ID3 tag or MPEG frame sync
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // ID3
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) // MPEG sync
  ) {
    return 'audio/mpeg';
  }

  // OGG: "OggS"
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return 'audio/ogg';
  }

  // FLAC: "fLaC"
  if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
    return 'audio/flac';
  }

  // M4A/MP4: "ftyp" at offset 4
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return 'audio/mp4';
  }

  // WebM: EBML header
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'audio/webm';
  }

  // Unknown format - let API try to detect
  logger.warn('Could not detect audio format from buffer, using generic binary type');
  return 'application/octet-stream';
}

/**
 * Converts a Web ReadableStream to a Node.js Readable stream
 * Handles both browser and Node.js environments
 * Uses dynamic import to avoid bundling node:stream in browser builds
 */
async function webStreamToNodeStream(webStream: ReadableStream<Uint8Array>) {
  try {
    // Dynamic import to avoid browser bundling issues
    const { Readable } = await import('node:stream');
    const reader = webStream.getReader();

    return new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null);
          } else {
            // Push the Uint8Array directly; Node.js Readable can handle it
            this.push(value);
          }
        } catch (error) {
          this.destroy(error as Error);
        }
      },
      destroy(error, callback) {
        reader.cancel().finally(() => callback(error));
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load node:stream module: ${message}`);
    throw new Error(
      `Cannot convert stream: node:stream module unavailable. This feature requires a Node.js environment.`
    );
  }
}

/**
 * function for text-to-speech
 */
async function fetchTextToSpeech(runtime: IAgentRuntime, options: OpenAITextToSpeechParams) {
  const defaultModel = getSetting(runtime, 'ELIZAOS_TTS_MODEL', 'gpt-4o-mini-tts');
  const defaultVoice = getSetting(runtime, 'ELIZAOS_TTS_VOICE', 'nova');
  const defaultInstructions = getSetting(runtime, 'ELIZAOS_TTS_INSTRUCTIONS', '');
  const baseURL = getBaseURL(runtime);

  const model = options.model || (defaultModel as string);
  const voice = options.voice || (defaultVoice as string);
  const instructions = options.instructions ?? (defaultInstructions as string);
  const format = options.format || 'mp3';

  try {
    const res = await fetch(`${baseURL}/audio/speech`, {
      method: 'POST',
      headers: {
        ...getAuthHeader(runtime),
        'Content-Type': 'application/json',
        // Hint desired audio format in Accept when possible
        ...(format === 'mp3' ? { Accept: 'audio/mpeg' } : {}),
      },
      body: JSON.stringify({
        model,
        voice,
        input: options.text,
        format,
        ...(instructions && { instructions }),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI TTS error ${res.status}: ${err}`);
    }

    // Ensure response body exists
    if (!res.body) {
      throw new Error('OpenAI TTS response body is null');
    }

    // In Node.js, convert Web ReadableStream to Node.js Readable
    // In browser, return the Web ReadableStream directly
    if (!isBrowser()) {
      return await webStreamToNodeStream(res.body);
    }

    return res.body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch speech from OpenAI TTS: ${message}`);
  }
}

/**
 * Defines the OpenAI plugin with its name, description, and configuration options.
 * @type {Plugin}
 */
export const openaiPlugin: Plugin = {
  name: 'openai',
  description: 'OpenAI plugin',
  config: {
    ELIZAOS_API_KEY: process.env.ELIZAOS_API_KEY,
    ELIZAOS_BASE_URL: process.env.ELIZAOS_BASE_URL,
    ELIZAOS_SMALL_MODEL: process.env.ELIZAOS_SMALL_MODEL,
    ELIZAOS_LARGE_MODEL: process.env.ELIZAOS_LARGE_MODEL,
    SMALL_MODEL: process.env.SMALL_MODEL,
    LARGE_MODEL: process.env.LARGE_MODEL,
    ELIZAOS_EMBEDDING_MODEL: process.env.ELIZAOS_EMBEDDING_MODEL,
    ELIZAOS_EMBEDDING_API_KEY: process.env.ELIZAOS_EMBEDDING_API_KEY,
    ELIZAOS_EMBEDDING_URL: process.env.ELIZAOS_EMBEDDING_URL,
    ELIZAOS_EMBEDDING_DIMENSIONS: process.env.ELIZAOS_EMBEDDING_DIMENSIONS,
    ELIZAOS_IMAGE_DESCRIPTION_MODEL: process.env.ELIZAOS_IMAGE_DESCRIPTION_MODEL,
    ELIZAOS_IMAGE_DESCRIPTION_MAX_TOKENS: process.env.ELIZAOS_IMAGE_DESCRIPTION_MAX_TOKENS,
    ELIZAOS_EXPERIMENTAL_TELEMETRY: process.env.ELIZAOS_EXPERIMENTAL_TELEMETRY,
  },
  async init(_config, runtime) {
    // do check in the background
    new Promise<void>(async (resolve) => {
      resolve();
      try {
        if (!getApiKey(runtime) && !isBrowser()) {
          logger.warn(
            'ELIZAOS_API_KEY is not set in environment - OpenAI functionality will be limited'
          );
          return;
        }
        try {
          const baseURL = getBaseURL(runtime);
          const response = await fetch(`${baseURL}/models`, {
            headers: { ...getAuthHeader(runtime) },
          });
          if (!response.ok) {
            logger.warn(`OpenAI API key validation failed: ${response.statusText}`);
            logger.warn('OpenAI functionality will be limited until a valid API key is provided');
          } else {
            logger.log('OpenAI API key validated successfully');
          }
        } catch (fetchError: unknown) {
          const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
          logger.warn(`Error validating OpenAI API key: ${message}`);
          logger.warn('OpenAI functionality will be limited until a valid API key is provided');
        }
      } catch (error: unknown) {
        const message =
          (error as { errors?: Array<{ message: string }> })?.errors
            ?.map((e) => e.message)
            .join(', ') || (error instanceof Error ? error.message : String(error));
        logger.warn(
          `OpenAI plugin configuration issue: ${message} - You need to configure the ELIZAOS_API_KEY in your environment variables`
        );
      }
    });
  },

  models: {
    [ModelType.TEXT_EMBEDDING]: async (
      runtime: IAgentRuntime,
      params: TextEmbeddingParams | string | null
    ): Promise<number[]> => {
      const embeddingModelName = getSetting(
        runtime,
        'ELIZAOS_EMBEDDING_MODEL',
        'text-embedding-3-small'
      );
      const embeddingDimension = Number.parseInt(
        getSetting(runtime, 'ELIZAOS_EMBEDDING_DIMENSIONS', '1536') || '1536',
        10
      ) as (typeof VECTOR_DIMS)[keyof typeof VECTOR_DIMS];

      if (!Object.values(VECTOR_DIMS).includes(embeddingDimension)) {
        const errorMsg = `Invalid embedding dimension: ${embeddingDimension}. Must be one of: ${Object.values(VECTOR_DIMS).join(', ')}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      if (params === null) {
        logger.debug('Creating test embedding for initialization');
        const testVector = Array(embeddingDimension).fill(0);
        testVector[0] = 0.1;
        return testVector;
      }
      let text: string;
      if (typeof params === 'string') {
        text = params;
      } else if (typeof params === 'object' && params.text) {
        text = params.text;
      } else {
        logger.warn('Invalid input format for embedding');
        const fallbackVector = Array(embeddingDimension).fill(0);
        fallbackVector[0] = 0.2;
        return fallbackVector;
      }
      if (!text.trim()) {
        logger.warn('Empty text for embedding');
        const emptyVector = Array(embeddingDimension).fill(0);
        emptyVector[0] = 0.3;
        return emptyVector;
      }

      const embeddingBaseURL = getEmbeddingBaseURL(runtime);

      try {
        const response = await fetch(`${embeddingBaseURL}/embeddings`, {
          method: 'POST',
          headers: {
            ...getAuthHeader(runtime, true),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: embeddingModelName,
            input: text,
          }),
        });

        // Clone available if needed for logging/debugging
        // const debugText = await response.clone().text().catch(() => "");

        if (!response.ok) {
          logger.error(`OpenAI API error: ${response.status} - ${response.statusText}`);
          const errorVector = Array(embeddingDimension).fill(0);
          errorVector[0] = 0.4;
          return errorVector;
        }

        const data = (await response.json()) as {
          data: [{ embedding: number[] }];
          usage?: { prompt_tokens: number; total_tokens: number };
        };

        if (!data?.data?.[0]?.embedding) {
          logger.error('API returned invalid structure');
          const errorVector = Array(embeddingDimension).fill(0);
          errorVector[0] = 0.5;
          return errorVector;
        }

        const embedding = data.data[0].embedding;

        if (data.usage) {
          const usage = {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: 0,
            totalTokens: data.usage.total_tokens,
          };

          emitModelUsageEvent(runtime, ModelType.TEXT_EMBEDDING, text, usage);
        }

        logger.log(`Got valid embedding with length ${embedding.length}`);
        return embedding;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error generating embedding: ${message}`);
        const errorVector = Array(embeddingDimension).fill(0);
        errorVector[0] = 0.6;
        return errorVector;
      }
    },
    [ModelType.TEXT_TOKENIZER_ENCODE]: async (
      _runtime,
      { prompt, modelType = ModelType.TEXT_LARGE }: TokenizeTextParams
    ) => {
      return await tokenizeText(modelType ?? ModelType.TEXT_LARGE, prompt);
    },
    [ModelType.TEXT_TOKENIZER_DECODE]: async (
      _runtime,
      { tokens, modelType = ModelType.TEXT_LARGE }: DetokenizeTextParams
    ) => {
      return await detokenizeText(modelType ?? ModelType.TEXT_LARGE, tokens);
    },
    [ModelType.TEXT_SMALL]: async (
      runtime: IAgentRuntime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
        frequencyPenalty = 0.7,
        presencePenalty = 0.7,
      }: GenerateTextParams
    ) => {
      const openai = createOpenAIClient(runtime);
      const modelName = getSmallModel(runtime);
      const experimentalTelemetry = getExperimentalTelemetry(runtime);

      logger.log(`[ELIZAOS_CLOUD] Using TEXT_SMALL model: ${modelName}`);
      logger.log(prompt);

      const { text: openaiResponse, usage } = await generateText({
        model: openai.languageModel(modelName),
        prompt: prompt,
        system: runtime.character.system ?? undefined,
        temperature: temperature,
        maxOutputTokens: maxTokens,
        frequencyPenalty: frequencyPenalty,
        presencePenalty: presencePenalty,
        stopSequences: stopSequences,
        experimental_telemetry: {
          isEnabled: experimentalTelemetry,
        },
      });

      if (usage) {
        emitModelUsageEvent(runtime, ModelType.TEXT_SMALL, prompt, usage);
      }

      return openaiResponse;
    },
    [ModelType.TEXT_LARGE]: async (
      runtime: IAgentRuntime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
        frequencyPenalty = 0.7,
        presencePenalty = 0.7,
      }: GenerateTextParams
    ) => {
      const openai = createOpenAIClient(runtime);
      const modelName = getLargeModel(runtime);
      const experimentalTelemetry = getExperimentalTelemetry(runtime);

      logger.log(`[ELIZAOS_CLOUD] Using TEXT_LARGE model: ${modelName}`);
      logger.log(prompt);

      const { text: openaiResponse, usage } = await generateText({
        model: openai.languageModel(modelName),
        prompt: prompt,
        system: runtime.character.system ?? undefined,
        temperature: temperature,
        maxOutputTokens: maxTokens,
        frequencyPenalty: frequencyPenalty,
        presencePenalty: presencePenalty,
        stopSequences: stopSequences,
        experimental_telemetry: {
          isEnabled: experimentalTelemetry,
        },
      });

      if (usage) {
        emitModelUsageEvent(runtime, ModelType.TEXT_LARGE, prompt, usage);
      }

      return openaiResponse;
    },
    [ModelType.IMAGE]: async (
      runtime: IAgentRuntime,
      params: {
        prompt: string;
        n?: number;
        size?: string;
      }
    ) => {
      const n = params.n || 1;
      const size = params.size || '1024x1024';
      const prompt = params.prompt;
      const modelName = 'gpt-image-1'; // Updated image model
      logger.log(`[ELIZAOS_CLOUD] Using IMAGE model: ${modelName}`);

      const baseURL = getBaseURL(runtime);

      try {
        const response = await fetch(`${baseURL}/images/generations`, {
          method: 'POST',
          headers: {
            ...getAuthHeader(runtime),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            prompt: prompt,
            n: n,
            size: size,
          }),
        });

        // const debugText = await response.clone().text().catch(() => "");

        if (!response.ok) {
          throw new Error(`Failed to generate image: ${response.statusText}`);
        }

        const data = await response.json();
        const typedData = data as { data: { url: string }[] };

        return typedData.data;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
    [ModelType.IMAGE_DESCRIPTION]: async (
      runtime: IAgentRuntime,
      params: ImageDescriptionParams | string
    ) => {
      let imageUrl: string;
      let promptText: string | undefined;
      const modelName = getImageDescriptionModel(runtime);
      logger.log(`[ELIZAOS_CLOUD] Using IMAGE_DESCRIPTION model: ${modelName}`);
      const maxTokens = Number.parseInt(
        getSetting(runtime, 'ELIZAOS_IMAGE_DESCRIPTION_MAX_TOKENS', '8192') || '8192',
        10
      );

      if (typeof params === 'string') {
        imageUrl = params;
        promptText = 'Please analyze this image and provide a title and detailed description.';
      } else {
        imageUrl = params.imageUrl;
        promptText =
          params.prompt ||
          'Please analyze this image and provide a title and detailed description.';
      }

      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ];

      const baseURL = getBaseURL(runtime);

      try {
        const requestBody: Record<string, any> = {
          model: modelName,
          messages: messages,
          max_tokens: maxTokens,
        };

        const response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(runtime),
          },
          body: JSON.stringify(requestBody),
        });

        // const debugText = await response.clone().text().catch(() => "");

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status}`);
        }

        const result: unknown = await response.json();

        type OpenAIResponseType = {
          choices?: Array<{
            message?: { content?: string };
            finish_reason?: string;
          }>;
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          };
        };

        const typedResult = result as OpenAIResponseType;
        const content = typedResult.choices?.[0]?.message?.content;

        if (typedResult.usage) {
          emitModelUsageEvent(
            runtime,
            ModelType.IMAGE_DESCRIPTION,
            typeof params === 'string' ? params : params.prompt || '',
            {
              inputTokens: typedResult.usage.prompt_tokens,
              outputTokens: typedResult.usage.completion_tokens,
              totalTokens: typedResult.usage.total_tokens,
            }
          );
        }

        if (!content) {
          return {
            title: 'Failed to analyze image',
            description: 'No response from API',
          };
        }

        // Check if a custom prompt was provided (not the default prompt)
        const isCustomPrompt =
          typeof params === 'object' &&
          params.prompt &&
          params.prompt !==
            'Please analyze this image and provide a title and detailed description.';

        // If custom prompt is used, return the raw content
        if (isCustomPrompt) {
          return content;
        }

        // Otherwise, maintain backwards compatibility with object return
        const titleMatch = content.match(/title[:\s]+(.+?)(?:\n|$)/i);
        const title = titleMatch?.[1]?.trim() || 'Image Analysis';
        const description = content.replace(/title[:\s]+(.+?)(?:\n|$)/i, '').trim();

        const processedResult = { title, description };
        return processedResult;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error analyzing image: ${message}`);
        return {
          title: 'Failed to analyze image',
          description: `Error: ${message}`,
        };
      }
    },
    [ModelType.TRANSCRIPTION]: async (
      runtime: IAgentRuntime,
      input: Blob | File | Buffer | OpenAITranscriptionParams
    ) => {
      let modelName = getSetting(runtime, 'ELIZAOS_TRANSCRIPTION_MODEL', 'gpt-4o-mini-transcribe');
      logger.log(`[ELIZAOS_CLOUD] Using TRANSCRIPTION model: ${modelName}`);

      const baseURL = getBaseURL(runtime);

      // Support Blob/File/Buffer directly, or an object with { audio: Blob/File/Buffer, ...options }
      let blob: Blob;
      let extraParams: OpenAITranscriptionParams | null = null;

      if (input instanceof Blob || input instanceof File) {
        blob = input as Blob;
      } else if (Buffer.isBuffer(input)) {
        // Convert Buffer to Blob for Node.js environments
        // Auto-detect MIME type from buffer content
        const detectedMimeType = detectAudioMimeType(input);
        logger.debug(`Auto-detected audio MIME type: ${detectedMimeType}`);
        // Cast to any to satisfy TypeScript's strict ArrayBufferLike typing
        // Note: Blob constructor creates a copy of the buffer data
        blob = new Blob([input] as any, { type: detectedMimeType });
      } else if (typeof input === 'object' && input !== null && (input as any).audio != null) {
        const params = input as any;
        if (
          !(params.audio instanceof Blob) &&
          !(params.audio instanceof File) &&
          !Buffer.isBuffer(params.audio)
        ) {
          throw new Error("TRANSCRIPTION param 'audio' must be a Blob/File/Buffer.");
        }
        // Convert Buffer to Blob if needed
        if (Buffer.isBuffer(params.audio)) {
          // Use provided mimeType or auto-detect from buffer
          let mimeType = params.mimeType;
          if (!mimeType) {
            mimeType = detectAudioMimeType(params.audio);
            logger.debug(`Auto-detected audio MIME type: ${mimeType}`);
          } else {
            logger.debug(`Using provided MIME type: ${mimeType}`);
          }
          // Cast to any to satisfy TypeScript's strict ArrayBufferLike typing
          // Note: Blob constructor creates a copy of the buffer data
          blob = new Blob([params.audio] as any, { type: mimeType });
        } else {
          blob = params.audio as Blob;
        }
        extraParams = params as OpenAITranscriptionParams;
        if (typeof params.model === 'string' && params.model) {
          modelName = params.model;
        }
      } else {
        throw new Error(
          'TRANSCRIPTION expects a Blob/File/Buffer or an object { audio: Blob/File/Buffer, mimeType?, language?, response_format?, timestampGranularities?, prompt?, temperature?, model? }'
        );
      }

      const mime = (blob as File).type || 'audio/webm';
      const filename =
        (blob as File).name ||
        (mime.includes('mp3') || mime.includes('mpeg')
          ? 'recording.mp3'
          : mime.includes('ogg')
            ? 'recording.ogg'
            : mime.includes('wav')
              ? 'recording.wav'
              : mime.includes('webm')
                ? 'recording.webm'
                : 'recording.bin');

      const formData = new FormData();
      formData.append('file', blob, filename);
      formData.append('model', String(modelName));
      if (extraParams) {
        if (typeof extraParams.language === 'string') {
          formData.append('language', String(extraParams.language));
        }
        if (typeof extraParams.response_format === 'string') {
          formData.append('response_format', String(extraParams.response_format));
        }
        if (typeof extraParams.prompt === 'string') {
          formData.append('prompt', String(extraParams.prompt));
        }
        if (typeof extraParams.temperature === 'number') {
          formData.append('temperature', String(extraParams.temperature));
        }
        if (Array.isArray(extraParams.timestampGranularities)) {
          for (const g of extraParams.timestampGranularities) {
            formData.append('timestamp_granularities[]', String(g));
          }
        }
      }

      try {
        const response = await fetch(`${baseURL}/audio/transcriptions`, {
          method: 'POST',
          headers: {
            ...getAuthHeader(runtime),
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Failed to transcribe audio: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as { text: string };
        return data.text || '';
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`TRANSCRIPTION error: ${message}`);
        throw error;
      }
    },
    [ModelType.TEXT_TO_SPEECH]: async (
      runtime: IAgentRuntime,
      input: string | OpenAITextToSpeechParams
    ) => {
      // Normalize input into options with per-call overrides
      const options: OpenAITextToSpeechParams =
        typeof input === 'string' ? { text: input } : (input as OpenAITextToSpeechParams);

      const resolvedModel =
        options.model || (getSetting(runtime, 'ELIZAOS_TTS_MODEL', 'gpt-4o-mini-tts') as string);
      logger.log(`[ELIZAOS_CLOUD] Using TEXT_TO_SPEECH model: ${resolvedModel}`);
      try {
        const speechStream = await fetchTextToSpeech(runtime, options);
        return speechStream;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error in TEXT_TO_SPEECH: ${message}`);
        throw error;
      }
    },
    [ModelType.OBJECT_SMALL]: async (runtime: IAgentRuntime, params: ObjectGenerationParams) => {
      return generateObjectByModelType(runtime, params, ModelType.OBJECT_SMALL, getSmallModel);
    },
    [ModelType.OBJECT_LARGE]: async (runtime: IAgentRuntime, params: ObjectGenerationParams) => {
      return generateObjectByModelType(runtime, params, ModelType.OBJECT_LARGE, getLargeModel);
    },
  },
  tests: [
    {
      name: 'ELIZAOS_plugin_tests',
      tests: [
        {
          name: 'ELIZAOS_test_url_and_api_key_validation',
          fn: async (runtime: IAgentRuntime) => {
            const baseURL = getBaseURL(runtime);
            const response = await fetch(`${baseURL}/models`, {
              headers: {
                Authorization: `Bearer ${getApiKey(runtime)}`,
              },
            });
            const data = await response.json();
            logger.log(
              { data: (data as { data?: unknown[] })?.data?.length ?? 'N/A' },
              'Models Available'
            );
            if (!response.ok) {
              throw new Error(`Failed to validate OpenAI API key: ${response.statusText}`);
            }
          },
        },
        {
          name: 'ELIZAOS_test_text_embedding',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
                text: 'Hello, world!',
              });
              logger.log({ embedding }, 'embedding');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_text_embedding: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'ELIZAOS_test_text_large',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const text = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: 'What is the nature of reality in 10 words?',
              });
              if (text.length === 0) {
                throw new Error('Failed to generate text');
              }
              logger.log({ text }, 'generated with test_text_large');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_text_large: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'ELIZAOS_test_text_small',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const text = await runtime.useModel(ModelType.TEXT_SMALL, {
                prompt: 'What is the nature of reality in 10 words?',
              });
              if (text.length === 0) {
                throw new Error('Failed to generate text');
              }
              logger.log({ text }, 'generated with test_text_small');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_text_small: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'ELIZAOS_test_image_generation',
          fn: async (runtime: IAgentRuntime) => {
            logger.log('ELIZAOS_test_image_generation');
            try {
              const image = await runtime.useModel(ModelType.IMAGE, {
                prompt: 'A beautiful sunset over a calm ocean',
                n: 1,
                size: '1024x1024',
              });
              logger.log({ image }, 'generated with test_image_generation');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_image_generation: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'image-description',
          fn: async (runtime: IAgentRuntime) => {
            try {
              logger.log('ELIZAOS_test_image_description');
              try {
                const result = await runtime.useModel(
                  ModelType.IMAGE_DESCRIPTION,
                  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Vitalik_Buterin_TechCrunch_London_2015_%28cropped%29.jpg/537px-Vitalik_Buterin_TechCrunch_London_2015_%28cropped%29.jpg'
                );

                if (
                  result &&
                  typeof result === 'object' &&
                  'title' in result &&
                  'description' in result
                ) {
                  logger.log({ result }, 'Image description');
                } else {
                  logger.error('Invalid image description result format:', result);
                }
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                logger.error(`Error in image description test: ${message}`);
              }
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : String(e);
              logger.error(`Error in ELIZAOS_test_image_description: ${message}`);
            }
          },
        },
        {
          name: 'ELIZAOS_test_transcription',
          fn: async (runtime: IAgentRuntime) => {
            logger.log('ELIZAOS_test_transcription');
            try {
              const response = await fetch(
                'https://upload.wikimedia.org/wikipedia/en/4/40/Chris_Benoit_Voice_Message.ogg'
              );
              const arrayBuffer = await response.arrayBuffer();
              const transcription = await runtime.useModel(
                ModelType.TRANSCRIPTION,
                Buffer.from(new Uint8Array(arrayBuffer))
              );
              logger.log({ transcription }, 'generated with test_transcription');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in test_transcription: ${message}`);
              throw error;
            }
          },
        },
        {
          name: 'ELIZAOS_test_text_tokenizer_encode',
          fn: async (runtime: IAgentRuntime) => {
            const prompt = 'Hello tokenizer encode!';
            const tokens = await runtime.useModel(ModelType.TEXT_TOKENIZER_ENCODE, { prompt });
            if (!Array.isArray(tokens) || tokens.length === 0) {
              throw new Error('Failed to tokenize text: expected non-empty array of tokens');
            }
            logger.log({ tokens }, 'Tokenized output');
          },
        },
        {
          name: 'ELIZAOS_test_text_tokenizer_decode',
          fn: async (runtime: IAgentRuntime) => {
            const prompt = 'Hello tokenizer decode!';
            const tokens = await runtime.useModel(ModelType.TEXT_TOKENIZER_ENCODE, { prompt });
            const decodedText = await runtime.useModel(ModelType.TEXT_TOKENIZER_DECODE, { tokens });
            if (decodedText !== prompt) {
              throw new Error(
                `Decoded text does not match original. Expected "${prompt}", got "${decodedText}"`
              );
            }
            logger.log({ decodedText }, 'Decoded text');
          },
        },
        {
          name: 'ELIZAOS_test_text_to_speech',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const response = await fetchTextToSpeech(runtime, {
                text: 'Hello, this is a test for text-to-speech.',
              });
              if (!response) {
                throw new Error('Failed to generate speech');
              }
              logger.log('Generated speech successfully');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Error in ELIZAOS_test_text_to_speech: ${message}`);
              throw error;
            }
          },
        },
      ],
    },
  ],
};
export default openaiPlugin;
