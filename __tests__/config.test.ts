import { describe, test, expect, jest, beforeEach, afterEach } from "bun:test";
import { elizaOSCloudPlugin } from "../src/index";
import { logger } from "@elizaos/core";
import * as undici from "undici";

const createMockRuntime = (env: Record<string, string>) => {
  return {
    getSetting: (key: string) => env[key],
    emitEvent: () => {},
    character: {
      system: "You are a helpful assistant.",
    },
  } as unknown as any;
};

describe("ElizaOS Cloud Plugin Configuration", () => {
  beforeEach(() => {
    jest.spyOn(undici, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
        headers: new Headers(),
      } as any),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("should warn when API key is missing", async () => {
    const originalApiKey = process.env.ELIZAOS_CLOUD_API_KEY;
    delete process.env.ELIZAOS_CLOUD_API_KEY;

    const mockRuntime = createMockRuntime({});
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

    if (elizaOSCloudPlugin.init) {
      await elizaOSCloudPlugin.init({}, mockRuntime);
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    if (originalApiKey) {
      process.env.ELIZAOS_CLOUD_API_KEY = originalApiKey;
    }
  });

  test("should initialize properly with valid API key", async () => {
    if (!process.env.ELIZAOS_CLOUD_API_KEY) {
      console.warn("Skipping test: ELIZAOS_CLOUD_API_KEY not set");
      return;
    }

    const mockRuntime = createMockRuntime({
      ELIZAOS_CLOUD_API_KEY: process.env.ELIZAOS_CLOUD_API_KEY,
    });

    if (elizaOSCloudPlugin.init) {
      await elizaOSCloudPlugin.init({}, mockRuntime);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(undici.fetch).toHaveBeenCalled();
  });

  test("should have TEXT_EMBEDDING model registered", () => {
    const { models } = elizaOSCloudPlugin;
    expect(models).toBeDefined();
    if (!models) return;
    expect(models).toHaveProperty("TEXT_EMBEDDING");
    expect(typeof models["TEXT_EMBEDDING"]).toBe("function");
  });

  test("should have TRANSCRIPTION model registered", () => {
    const { models } = elizaOSCloudPlugin;
    expect(models).toBeDefined();
    if (!models) return;
    expect(models).toHaveProperty("TRANSCRIPTION");
    expect(typeof models["TRANSCRIPTION"]).toBe("function");
  });

  test("should have TEXT_TO_SPEECH model registered", () => {
    const { models } = elizaOSCloudPlugin;
    expect(models).toBeDefined();
    if (!models) return;
    expect(models).toHaveProperty("TEXT_TO_SPEECH");
    expect(typeof models["TEXT_TO_SPEECH"]).toBe("function");
  });

  test("should have TEXT_TOKENIZER_ENCODE model registered", () => {
    const { models } = elizaOSCloudPlugin;
    expect(models).toBeDefined();
    if (!models) return;
    expect(models).toHaveProperty("TEXT_TOKENIZER_ENCODE");
    expect(typeof models["TEXT_TOKENIZER_ENCODE"]).toBe("function");
  });

  test("should have TEXT_TOKENIZER_DECODE model registered", () => {
    const { models } = elizaOSCloudPlugin;
    expect(models).toBeDefined();
    if (!models) return;
    expect(models).toHaveProperty("TEXT_TOKENIZER_DECODE");
    expect(typeof models["TEXT_TOKENIZER_DECODE"]).toBe("function");
  });
});
