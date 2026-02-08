import { describe, test, expect, beforeAll } from "bun:test";
import { elizaOSCloudPlugin } from "../src/index";

const mockRuntime = {
  getSetting: (key: string) => process.env[key],
  character: {
    system: "You are a helpful assistant.",
    name: "Test Assistant",
    description: "A test assistant",
    version: "1.0",
    actions: [],
    agentSettings: {},
    instructions: [],
  },
  emitEvent: () => {},
  agentId: "test-agent",
  providers: {},
  actions: {},
  evaluators: {},
  hooks: {},
  settings: {},
  storage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
} as unknown as any;

describe("ElizaOS Cloud Plugin", () => {
  beforeAll(async () => {
    if (elizaOSCloudPlugin.init) {
      await elizaOSCloudPlugin.init({}, mockRuntime);
    }
  });

  describe("TEXT_SMALL Model", () => {
    test("should generate text with TEXT_SMALL model", async () => {
      if (!process.env.ELIZAOS_CLOUD_API_KEY) {
        console.warn("Skipping test: ELIZAOS_CLOUD_API_KEY not set");
        return;
      }

      const prompt = "Hello, how are you today?";

      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["TEXT_SMALL"]
      ) {
        const textHandler = elizaOSCloudPlugin.models["TEXT_SMALL"];
        const response = await textHandler(mockRuntime, { prompt });

        expect(response).toBeDefined();
        expect(typeof response).toBe("string");
        expect(response.length).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe("TEXT_LARGE Model", () => {
    test("should generate text with TEXT_LARGE model", async () => {
      if (!process.env.ELIZAOS_CLOUD_API_KEY) {
        console.warn("Skipping test: ELIZAOS_CLOUD_API_KEY not set");
        return;
      }

      const prompt = "Explain quantum computing in simple terms.";

      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["TEXT_LARGE"]
      ) {
        const textHandler = elizaOSCloudPlugin.models["TEXT_LARGE"];
        const response = await textHandler(mockRuntime, { prompt });

        expect(response).toBeDefined();
        expect(typeof response).toBe("string");
        expect(response.length).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe("OBJECT_SMALL Model", () => {
    test("should generate JSON with OBJECT_SMALL model", async () => {
      if (!process.env.ELIZAOS_CLOUD_API_KEY) {
        console.warn("Skipping test: ELIZAOS_CLOUD_API_KEY not set");
        return;
      }

      const prompt =
        "Create a JSON object representing a person with name, age, and hobbies.";

      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["OBJECT_SMALL"]
      ) {
        const objectHandler = elizaOSCloudPlugin.models["OBJECT_SMALL"];
        const response = await objectHandler(mockRuntime, { prompt });

        expect(response).toBeDefined();
        expect(typeof response).toBe("object");
        expect(response).not.toBeNull();
      }
    }, 30000);
  });

  describe("TEXT_EMBEDDING Model", () => {
    test("should generate embeddings with TEXT_EMBEDDING model", async () => {
      if (!process.env.ELIZAOS_CLOUD_API_KEY) {
        console.warn("Skipping test: ELIZAOS_CLOUD_API_KEY not set");
        return;
      }

      const text = "Hello, this is a test for embeddings.";

      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["TEXT_EMBEDDING"]
      ) {
        const embeddingHandler = elizaOSCloudPlugin.models["TEXT_EMBEDDING"];
        const embedding = await embeddingHandler(mockRuntime, { text });

        expect(embedding).toBeDefined();
        expect(Array.isArray(embedding)).toBe(true);
        expect(embedding.length).toBeGreaterThan(0);
        expect(typeof embedding[0]).toBe("number");
      }
    }, 30000);

    test("should return test vector for null input", async () => {
      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["TEXT_EMBEDDING"]
      ) {
        const embeddingHandler = elizaOSCloudPlugin.models["TEXT_EMBEDDING"];
        const embedding = await embeddingHandler(mockRuntime, null);

        expect(embedding).toBeDefined();
        expect(Array.isArray(embedding)).toBe(true);
        expect(embedding.length).toBeGreaterThan(0);
      }
    });
  });

  describe("IMAGE_DESCRIPTION Model", () => {
    test("should describe an image with IMAGE_DESCRIPTION model", async () => {
      if (!process.env.ELIZAOS_CLOUD_API_KEY) {
        console.warn("Skipping test: ELIZAOS_CLOUD_API_KEY not set");
        return;
      }

      const imageUrl =
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Gull_portrait_ca_usa.jpg/1280px-Gull_portrait_ca_usa.jpg";

      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["IMAGE_DESCRIPTION"]
      ) {
        const imageDescHandler = elizaOSCloudPlugin.models["IMAGE_DESCRIPTION"];
        const response = await imageDescHandler(mockRuntime, imageUrl);

        expect(response).toBeDefined();
        expect(response).toHaveProperty("title");
        expect(response).toHaveProperty("description");
      }
    }, 60000);
  });

  describe("TRANSCRIPTION Model (ElevenLabs STT)", () => {
    test("should transcribe audio with TRANSCRIPTION model", async () => {
      if (!process.env.ELIZAOS_CLOUD_API_KEY) {
        console.warn("Skipping test: ELIZAOS_CLOUD_API_KEY not set");
        return;
      }

      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["TRANSCRIPTION"]
      ) {
        const response = await fetch(
          "https://upload.wikimedia.org/wikipedia/en/4/40/Chris_Benoit_Voice_Message.ogg",
        );
        const arrayBuffer = await response.arrayBuffer();
        const transcriptionHandler = elizaOSCloudPlugin.models["TRANSCRIPTION"];
        const transcript = await transcriptionHandler(
          mockRuntime,
          Buffer.from(new Uint8Array(arrayBuffer)),
        );

        expect(transcript).toBeDefined();
        expect(typeof transcript).toBe("string");
        expect(transcript.length).toBeGreaterThan(0);
      }
    }, 60000);
  });

  describe("TEXT_TO_SPEECH Model (ElevenLabs TTS)", () => {
    test("should generate speech with TEXT_TO_SPEECH model", async () => {
      if (!process.env.ELIZAOS_CLOUD_API_KEY) {
        console.warn("Skipping test: ELIZAOS_CLOUD_API_KEY not set");
        return;
      }

      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["TEXT_TO_SPEECH"]
      ) {
        const ttsHandler = elizaOSCloudPlugin.models["TEXT_TO_SPEECH"];
        const audioStream = await ttsHandler(
          mockRuntime,
          "Hello, this is a test.",
        );

        expect(audioStream).toBeDefined();
      }
    }, 60000);
  });

  describe("TEXT_TOKENIZER Models", () => {
    test("should encode text with TEXT_TOKENIZER_ENCODE", async () => {
      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["TEXT_TOKENIZER_ENCODE"]
      ) {
        const encodeHandler =
          elizaOSCloudPlugin.models["TEXT_TOKENIZER_ENCODE"];
        const tokens = await encodeHandler(mockRuntime, {
          prompt: "Hello tokenizer!",
          modelType: "TEXT_SMALL",
        });

        expect(tokens).toBeDefined();
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);
      }
    });

    test("should decode tokens with TEXT_TOKENIZER_DECODE", async () => {
      if (
        elizaOSCloudPlugin.models &&
        elizaOSCloudPlugin.models["TEXT_TOKENIZER_ENCODE"] &&
        elizaOSCloudPlugin.models["TEXT_TOKENIZER_DECODE"]
      ) {
        const encodeHandler =
          elizaOSCloudPlugin.models["TEXT_TOKENIZER_ENCODE"];
        const decodeHandler =
          elizaOSCloudPlugin.models["TEXT_TOKENIZER_DECODE"];

        const originalText = "Hello tokenizer!";
        const tokens = await encodeHandler(mockRuntime, {
          prompt: originalText,
          modelType: "TEXT_SMALL",
        });
        const decodedText = await decodeHandler(mockRuntime, {
          tokens,
          modelType: "TEXT_SMALL",
        });

        expect(decodedText).toBe(originalText);
      }
    });
  });
});
