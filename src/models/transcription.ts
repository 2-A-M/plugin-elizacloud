import type { IAgentRuntime, TranscriptionParams } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { getBaseURL, getAuthHeader } from "../utils/config";
import { detectAudioMimeType } from "../utils/helpers";

/**
 * TRANSCRIPTION model handler for ElevenLabs STT
 * Accepts: TranscriptionParams | Buffer | string (audioUrl)
 */
export async function handleTranscription(
  runtime: IAgentRuntime,
  input: TranscriptionParams | Buffer | string,
): Promise<string> {
  logger.log("[ELIZAOS_CLOUD] Using TRANSCRIPTION via ElevenLabs STT");

  const baseURL = getBaseURL(runtime);
  const sttURL = baseURL.replace("/v1", "") + "/elevenlabs/stt";

  let blob: Blob;
  let languageCode: string | undefined;

  // Handle different input types
  if (typeof input === "string") {
    // Input is an audioUrl - fetch the audio
    logger.debug(`[ELIZAOS_CLOUD] Fetching audio from URL: ${input}`);
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio from URL: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const mimeType = detectAudioMimeType(Buffer.from(uint8));
    blob = new Blob([uint8], { type: mimeType });
  } else if (Buffer.isBuffer(input)) {
    // Input is a Buffer - convert to Uint8Array for Blob compatibility
    const mimeType = detectAudioMimeType(input);
    logger.debug(`[ELIZAOS_CLOUD] Auto-detected audio MIME type: ${mimeType}`);
    blob = new Blob([new Uint8Array(input)], { type: mimeType });
  } else if (typeof input === "object" && input !== null) {
    // Input is TranscriptionParams with audioUrl
    const params = input as TranscriptionParams;
    if (params.audioUrl) {
      logger.debug(
        `[ELIZAOS_CLOUD] Fetching audio from URL: ${params.audioUrl}`,
      );
      const response = await fetch(params.audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio from URL: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const mimeType = detectAudioMimeType(Buffer.from(uint8));
      blob = new Blob([uint8], { type: mimeType });
    } else {
      throw new Error(
        "TRANSCRIPTION requires audioUrl in TranscriptionParams or a Buffer/string input",
      );
    }
  } else {
    throw new Error(
      "TRANSCRIPTION expects a string (audioUrl), Buffer, or TranscriptionParams { audioUrl, prompt? }",
    );
  }

  // Determine filename from mime type
  const mime = blob.type || "audio/webm";
  const filename =
    mime.includes("mp3") || mime.includes("mpeg")
      ? "recording.mp3"
      : mime.includes("ogg")
        ? "recording.ogg"
        : mime.includes("wav")
          ? "recording.wav"
          : mime.includes("webm")
            ? "recording.webm"
            : "recording.bin";

  try {
    const formData = new FormData();
    formData.append("audio", blob, filename);
    if (languageCode) {
      formData.append("languageCode", languageCode);
    }

    const response = await fetch(sttURL, {
      method: "POST",
      headers: {
        ...getAuthHeader(runtime),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to transcribe audio: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      transcript: string;
      duration_ms: number;
    };
    return data.transcript || "";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[ELIZAOS_CLOUD] TRANSCRIPTION error: ${message}`);
    throw error;
  }
}
