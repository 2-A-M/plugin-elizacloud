/**
 * Unit tests for ElizaCloud model configuration resolution.
 *
 * Verifies that all model slots (small, large, reasoning, research, TTS,
 * transcription, image, embedding) resolve correctly through the
 * priority chain: plugin env var > generic env var > default.
 */

import type { IAgentRuntime } from "@elizaos/core";
import { describe, expect, it } from "vitest";
import {
  getActionPlannerModel,
  getImageDescriptionModel,
  getImageGenerationModel,
  getLargeModel,
  getMegaModel,
  getMiniModel,
  getNanoModel,
  getReasoningLargeModel,
  getReasoningSmallModel,
  getResponseHandlerModel,
  getResponseModel,
  getResearchModel,
  getSmallModel,
  getTranscriptionModel,
  getTTSModel,
} from "../../utils/config";

function mockRuntime(settings: Record<string, string | undefined> = {}): IAgentRuntime {
  return {
    getSetting(key: string): string | undefined {
      return settings[key];
    },
  } as IAgentRuntime;
}

describe("Model config: small model", () => {
  it("returns default when nothing is set", () => {
    const model = getSmallModel(mockRuntime());
    expect(model).toBe("openai/gpt-5-mini");
  });

  it("ELIZAOS_CLOUD_SMALL_MODEL takes priority", () => {
    const model = getSmallModel(
      mockRuntime({
        ELIZAOS_CLOUD_SMALL_MODEL: "anthropic/claude-3-5-haiku",
        SMALL_MODEL: "gpt-4o-mini",
      })
    );
    expect(model).toBe("anthropic/claude-3-5-haiku");
  });

  it("SMALL_MODEL is used as fallback", () => {
    const model = getSmallModel(mockRuntime({ SMALL_MODEL: "google/gemini-2.0-flash" }));
    expect(model).toBe("google/gemini-2.0-flash");
  });
});

describe("Model config: large model", () => {
  it("returns default when nothing is set", () => {
    const model = getLargeModel(mockRuntime());
    expect(model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("ELIZAOS_CLOUD_LARGE_MODEL takes priority", () => {
    const model = getLargeModel(
      mockRuntime({
        ELIZAOS_CLOUD_LARGE_MODEL: "anthropic/claude-sonnet-4",
        LARGE_MODEL: "gpt-4o",
      })
    );
    expect(model).toBe("anthropic/claude-sonnet-4");
  });

  it("LARGE_MODEL is used as fallback", () => {
    const model = getLargeModel(mockRuntime({ LARGE_MODEL: "google/gemini-1.5-pro" }));
    expect(model).toBe("google/gemini-1.5-pro");
  });
});

describe("Model config: nano model", () => {
  it("falls back to small model by default", () => {
    expect(getNanoModel(mockRuntime())).toBe("openai/gpt-5-mini");
  });

  it("prefers explicit nano model over generic and fallback slots", () => {
    expect(
      getNanoModel(
        mockRuntime({
          ELIZAOS_CLOUD_NANO_MODEL: "google/gemini-2.5-flash-lite-nano-ft",
          NANO_MODEL: "generic-nano",
          ELIZAOS_CLOUD_SMALL_MODEL: "cloud-small",
        })
      )
    ).toBe("google/gemini-2.5-flash-lite-nano-ft");
  });
});

describe("Model config: mini model", () => {
  it("falls back to small model by default", () => {
    expect(getMiniModel(mockRuntime())).toBe("openai/gpt-5-mini");
  });

  it("prefers explicit mini model over generic and fallback slots", () => {
    expect(
      getMiniModel(
        mockRuntime({
          ELIZAOS_CLOUD_MINI_MODEL: "google/gemini-2.5-flash-lite-mini-ft",
          MINI_MODEL: "generic-mini",
          ELIZAOS_CLOUD_SMALL_MODEL: "cloud-small",
        })
      )
    ).toBe("google/gemini-2.5-flash-lite-mini-ft");
  });
});

describe("Model config: mega model", () => {
  it("falls back to large model by default", () => {
    expect(getMegaModel(mockRuntime())).toBe("anthropic/claude-sonnet-4.5");
  });

  it("prefers explicit mega model over generic and fallback slots", () => {
    expect(
      getMegaModel(
        mockRuntime({
          ELIZAOS_CLOUD_MEGA_MODEL: "google/gemini-2.5-pro-ft",
          MEGA_MODEL: "generic-mega",
          ELIZAOS_CLOUD_LARGE_MODEL: "cloud-large",
        })
      )
    ).toBe("google/gemini-2.5-pro-ft");
  });
});

describe("Model config: response handler model", () => {
  it("falls back to mini then small by default", () => {
    expect(getResponseHandlerModel(mockRuntime())).toBe("openai/gpt-5-mini");
  });

  it("prefers explicit response-handler slots over generic fallbacks", () => {
    expect(
      getResponseHandlerModel(
        mockRuntime({
          ELIZAOS_CLOUD_RESPONSE_HANDLER_MODEL: "google/gemini-2.5-flash-lite-ft-should",
          ELIZAOS_CLOUD_SHOULD_RESPOND_MODEL: "cloud-should",
          RESPONSE_HANDLER_MODEL: "generic-response-handler",
          SHOULD_RESPOND_MODEL: "generic-should",
          ELIZAOS_CLOUD_MINI_MODEL: "cloud-mini",
        })
      )
    ).toBe("google/gemini-2.5-flash-lite-ft-should");
  });
});

describe("Model config: action planner model", () => {
  it("falls back to small by default", () => {
    expect(getActionPlannerModel(mockRuntime())).toBe("openai/gpt-5-mini");
  });

  it("prefers explicit planner slots over generic fallbacks", () => {
    expect(
      getActionPlannerModel(
        mockRuntime({
          ELIZAOS_CLOUD_ACTION_PLANNER_MODEL: "google/gemini-2.5-flash-ft-plan",
          ELIZAOS_CLOUD_PLANNER_MODEL: "cloud-planner",
          ACTION_PLANNER_MODEL: "generic-action-planner",
          PLANNER_MODEL: "generic-planner",
          ELIZAOS_CLOUD_SMALL_MODEL: "cloud-small",
        })
      )
    ).toBe("google/gemini-2.5-flash-ft-plan");
  });
});

describe("Model config: response model", () => {
  it("falls back to large by default", () => {
    expect(getResponseModel(mockRuntime())).toBe("anthropic/claude-sonnet-4.5");
  });

  it("prefers explicit response model over the large slot", () => {
    expect(
      getResponseModel(
        mockRuntime({
          ELIZAOS_CLOUD_RESPONSE_MODEL: "google/gemini-2.5-flash-ft-response",
          RESPONSE_MODEL: "generic-response",
          ELIZAOS_CLOUD_LARGE_MODEL: "cloud-large",
        })
      )
    ).toBe("google/gemini-2.5-flash-ft-response");
  });
});

describe("Model config: reasoning small", () => {
  it("returns default deepseek-r1", () => {
    const model = getReasoningSmallModel(mockRuntime());
    expect(model).toBe("deepseek/deepseek-r1");
  });

  it("ELIZAOS_CLOUD_REASONING_SMALL_MODEL takes priority", () => {
    const model = getReasoningSmallModel(
      mockRuntime({
        ELIZAOS_CLOUD_REASONING_SMALL_MODEL: "openai/o4-mini",
      })
    );
    expect(model).toBe("openai/o4-mini");
  });

  it("REASONING_SMALL_MODEL is used as fallback", () => {
    const model = getReasoningSmallModel(mockRuntime({ REASONING_SMALL_MODEL: "openai/o3-mini" }));
    expect(model).toBe("openai/o3-mini");
  });
});

describe("Model config: reasoning large", () => {
  it("returns default claude-opus-4.5", () => {
    const model = getReasoningLargeModel(mockRuntime());
    expect(model).toBe("anthropic/claude-opus-4.5");
  });

  it("ELIZAOS_CLOUD_REASONING_LARGE_MODEL takes priority", () => {
    const model = getReasoningLargeModel(
      mockRuntime({
        ELIZAOS_CLOUD_REASONING_LARGE_MODEL: "openai/o3",
      })
    );
    expect(model).toBe("openai/o3");
  });
});

describe("Model config: research model", () => {
  it("returns default o3-deep-research", () => {
    const model = getResearchModel(mockRuntime());
    expect(model).toBe("o3-deep-research");
  });

  it("ELIZAOS_CLOUD_RESEARCH_MODEL takes priority", () => {
    const model = getResearchModel(
      mockRuntime({
        ELIZAOS_CLOUD_RESEARCH_MODEL: "o4-mini-deep-research",
      })
    );
    expect(model).toBe("o4-mini-deep-research");
  });
});

describe("Model config: TTS model", () => {
  it("returns default gpt-5-mini-tts", () => {
    const model = getTTSModel(mockRuntime());
    expect(model).toBe("gpt-5-mini-tts");
  });

  it("ELIZAOS_CLOUD_TTS_MODEL takes priority", () => {
    const model = getTTSModel(mockRuntime({ ELIZAOS_CLOUD_TTS_MODEL: "elevenlabs/turbo-v2" }));
    expect(model).toBe("elevenlabs/turbo-v2");
  });
});

describe("Model config: transcription model", () => {
  it("returns default gpt-5-mini-transcribe", () => {
    const model = getTranscriptionModel(mockRuntime());
    expect(model).toBe("gpt-5-mini-transcribe");
  });

  it("ELIZAOS_CLOUD_TRANSCRIPTION_MODEL takes priority", () => {
    const model = getTranscriptionModel(
      mockRuntime({ ELIZAOS_CLOUD_TRANSCRIPTION_MODEL: "whisper-1" })
    );
    expect(model).toBe("whisper-1");
  });
});

describe("Model config: image description model", () => {
  it("returns default gpt-5-mini", () => {
    const model = getImageDescriptionModel(mockRuntime());
    expect(model).toBe("gpt-5-mini");
  });
});

describe("Model config: image generation model", () => {
  it("returns default google/gemini-2.5-flash-image", () => {
    const model = getImageGenerationModel(mockRuntime());
    expect(model).toBe("google/gemini-2.5-flash-image");
  });

  it("ELIZAOS_CLOUD_IMAGE_GENERATION_MODEL takes priority", () => {
    const model = getImageGenerationModel(
      mockRuntime({
        ELIZAOS_CLOUD_IMAGE_GENERATION_MODEL: "dall-e-3",
      })
    );
    expect(model).toBe("dall-e-3");
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe("Model config edge cases", () => {
  it("empty string cloud model is returned as-is (not filtered)", () => {
    const model = getSmallModel(
      mockRuntime({
        ELIZAOS_CLOUD_SMALL_MODEL: "",
        SMALL_MODEL: "gpt-4o-mini",
      })
    );
    // getSetting returns empty string, which is not undefined/null,
    // so ?? does not trigger. This is intentional — empty string means
    // the user explicitly cleared the value.
    expect(model).toBe("");
  });

  it("undefined cloud model falls back to generic", () => {
    const model = getSmallModel(
      mockRuntime({
        ELIZAOS_CLOUD_SMALL_MODEL: undefined,
        SMALL_MODEL: "custom-model",
      })
    );
    expect(model).toBe("custom-model");
  });

  it("model with provider prefix works (openai/gpt-5)", () => {
    const model = getSmallModel(mockRuntime({ ELIZAOS_CLOUD_SMALL_MODEL: "openai/gpt-5" }));
    expect(model).toBe("openai/gpt-5");
  });

  it("all model slots return strings, never undefined", () => {
    const rt = mockRuntime();
    expect(typeof getSmallModel(rt)).toBe("string");
    expect(typeof getLargeModel(rt)).toBe("string");
    expect(typeof getReasoningSmallModel(rt)).toBe("string");
    expect(typeof getReasoningLargeModel(rt)).toBe("string");
    expect(typeof getResearchModel(rt)).toBe("string");
    expect(typeof getTTSModel(rt)).toBe("string");
    expect(typeof getTranscriptionModel(rt)).toBe("string");
    expect(typeof getImageDescriptionModel(rt)).toBe("string");
    expect(typeof getImageGenerationModel(rt)).toBe("string");
  });

  it("all defaults are non-empty strings", () => {
    const rt = mockRuntime();
    expect(getSmallModel(rt).length).toBeGreaterThan(0);
    expect(getLargeModel(rt).length).toBeGreaterThan(0);
    expect(getReasoningSmallModel(rt).length).toBeGreaterThan(0);
    expect(getReasoningLargeModel(rt).length).toBeGreaterThan(0);
    expect(getResearchModel(rt).length).toBeGreaterThan(0);
    expect(getTTSModel(rt).length).toBeGreaterThan(0);
    expect(getTranscriptionModel(rt).length).toBeGreaterThan(0);
    expect(getImageDescriptionModel(rt).length).toBeGreaterThan(0);
    expect(getImageGenerationModel(rt).length).toBeGreaterThan(0);
  });

  it("three-way priority: cloud > generic > default", () => {
    // All three set — cloud wins
    expect(
      getSmallModel(
        mockRuntime({
          ELIZAOS_CLOUD_SMALL_MODEL: "cloud-model",
          SMALL_MODEL: "generic-model",
        })
      )
    ).toBe("cloud-model");

    // Only generic set — generic wins
    expect(getSmallModel(mockRuntime({ SMALL_MODEL: "generic-model" }))).toBe("generic-model");

    // Nothing set — default wins
    expect(getSmallModel(mockRuntime())).toBe("openai/gpt-5-mini");
  });
});
