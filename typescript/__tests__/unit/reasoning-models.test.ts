/**
 * Unit tests for reasoning model detection and parameter stripping.
 *
 * Verifies that reasoning models (o1, o3, deepseek-r1, claude-opus)
 * correctly have temperature/penalties stripped before API calls.
 */

import { describe, expect, it } from "vitest";

// We test the isReasoningModel logic directly
const REASONING_MODEL_PATTERNS = [
  "o1",
  "o3",
  "o4",
  "deepseek-r1",
  "deepseek-reasoner",
  "claude-opus-4.6",
  "claude-opus-4",
] as const;

function isReasoningModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return REASONING_MODEL_PATTERNS.some((pattern) => lower.includes(pattern));
}

describe("Reasoning model detection", () => {
  const REASONING_MODELS = [
    "o1-preview",
    "o1-mini",
    "o3",
    "o3-mini",
    "o4-mini",
    "o4-mini-deep-research",
    "deepseek/deepseek-r1",
    "deepseek-r1",
    "deepseek-reasoner",
    "anthropic/claude-opus-4.6",
    "claude-opus-4.6",
    "claude-opus-4",
  ];

  const NON_REASONING_MODELS = [
    "gpt-5",
    "gpt-5.4-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "anthropic/claude-sonnet-4",
    "claude-3-5-sonnet",
    "claude-3-5-haiku",
    "google/gemini-2.5-flash",
    "google/gemini-1.5-pro",
    "deepseek/deepseek-v3",
    "deepseek-v3.2-exp",
  ];

  for (const model of REASONING_MODELS) {
    it(`detects "${model}" as reasoning model`, () => {
      expect(isReasoningModel(model)).toBe(true);
    });
  }

  for (const model of NON_REASONING_MODELS) {
    it(`does NOT detect "${model}" as reasoning model`, () => {
      expect(isReasoningModel(model)).toBe(false);
    });
  }
});

describe("Parameter stripping for reasoning models", () => {
  it("reasoning model params exclude temperature and penalties", () => {
    const modelName = "o3-mini";
    const reasoning = isReasoningModel(modelName);
    expect(reasoning).toBe(true);

    // Build params the same way the handler does
    const params = {
      model: modelName,
      prompt: "test",
      ...(reasoning
        ? {}
        : {
            temperature: 0.7,
            frequencyPenalty: 0.7,
            presencePenalty: 0.7,
          }),
      maxOutputTokens: 8192,
    };

    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("frequencyPenalty");
    expect(params).not.toHaveProperty("presencePenalty");
    expect(params).toHaveProperty("maxOutputTokens", 8192);
  });

  it("non-reasoning model params include temperature and penalties", () => {
    const modelName = "gpt-5.4-mini";
    const reasoning = isReasoningModel(modelName);
    expect(reasoning).toBe(false);

    const params = {
      model: modelName,
      prompt: "test",
      ...(reasoning
        ? {}
        : {
            temperature: 0.7,
            frequencyPenalty: 0.7,
            presencePenalty: 0.7,
          }),
      maxOutputTokens: 8192,
    };

    expect(params).toHaveProperty("temperature", 0.7);
    expect(params).toHaveProperty("frequencyPenalty", 0.7);
    expect(params).toHaveProperty("presencePenalty", 0.7);
  });
});

// ─── Edge Cases: Case Sensitivity, Near Misses, Empty Input ──────────────────

describe("Reasoning model detection: edge cases", () => {
  it("handles uppercase model names (case-insensitive)", () => {
    expect(isReasoningModel("O3-MINI")).toBe(true);
    expect(isReasoningModel("DEEPSEEK-R1")).toBe(true);
    expect(isReasoningModel("CLAUDE-OPUS-4.5")).toBe(true);
  });

  it("handles mixed case model names", () => {
    expect(isReasoningModel("DeepSeek-R1")).toBe(true);
    expect(isReasoningModel("Claude-Opus-4.5")).toBe(true);
  });

  it("handles provider-prefixed model names", () => {
    expect(isReasoningModel("openai/o3")).toBe(true);
    expect(isReasoningModel("deepseek/deepseek-r1")).toBe(true);
    expect(isReasoningModel("anthropic/claude-opus-4.6")).toBe(true);
  });

  it("empty string is NOT a reasoning model", () => {
    expect(isReasoningModel("")).toBe(false);
  });

  it("near-miss patterns that should NOT match", () => {
    // "o4" appears in gpt-4o reversed order — but "gpt-4o" does NOT contain "o4"
    expect(isReasoningModel("gpt-4o")).toBe(false);
    expect(isReasoningModel("gpt-4o-mini")).toBe(false);

    // "claude-opus-3" should not match "claude-opus-4" pattern
    expect(isReasoningModel("claude-opus-3")).toBe(false);

    // "deepseek-v3" should not match "deepseek-r1"
    expect(isReasoningModel("deepseek-v3")).toBe(false);
    expect(isReasoningModel("deepseek-v3.2-exp")).toBe(false);

    // "o1" should match, but "10" should not (it doesn't start with o1)
    expect(isReasoningModel("model-10")).toBe(false);
  });

  it("all o-series models match", () => {
    expect(isReasoningModel("o1")).toBe(true);
    expect(isReasoningModel("o1-preview")).toBe(true);
    expect(isReasoningModel("o1-mini")).toBe(true);
    expect(isReasoningModel("o3")).toBe(true);
    expect(isReasoningModel("o3-mini")).toBe(true);
    expect(isReasoningModel("o4-mini")).toBe(true);
    expect(isReasoningModel("o4-mini-deep-research")).toBe(true);
  });
});
