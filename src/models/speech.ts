import type { IAgentRuntime, TextToSpeechParams } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { getSetting, getBaseURL, getAuthHeader } from "../utils/config";

/**
 * TEXT_TO_SPEECH model handler for ElevenLabs TTS
 * Accepts: TextToSpeechParams | string
 * Returns: ArrayBuffer (audio/mpeg)
 */
export async function handleTextToSpeech(
  runtime: IAgentRuntime,
  input: TextToSpeechParams | string,
): Promise<ArrayBuffer> {
  const text = typeof input === "string" ? input : input.text;
  const voice =
    (typeof input === "object" ? input.voice : undefined) ||
    (getSetting(
      runtime,
      "ELIZAOS_CLOUD_TTS_VOICE",
      "JBFqnCBsd6RMkjVDRZzb",
    ) as string);

  const model = getSetting(
    runtime,
    "ELIZAOS_CLOUD_TTS_MODEL",
    "eleven_flash_v2_5",
  ) as string;

  logger.log(
    `[ELIZAOS_CLOUD] Using TEXT_TO_SPEECH: model=${model}, voice=${voice}`,
  );

  const baseURL = getBaseURL(runtime);
  const ttsURL = baseURL.replace("/v1", "") + "/elevenlabs/tts";

  try {
    const res = await fetch(ttsURL, {
      method: "POST",
      headers: {
        ...getAuthHeader(runtime),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        voiceId: voice,
        modelId: model,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElizaOS Cloud TTS error ${res.status}: ${err}`);
    }

    return await res.arrayBuffer();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[ELIZAOS_CLOUD] TEXT_TO_SPEECH error: ${message}`);
    throw error;
  }
}
