import { config } from "dotenv";
import { beforeAll } from "bun:test";
import { resolve } from "path";

beforeAll(() => {
  config({ path: resolve(process.cwd(), ".env") });

  if (!process.env.ELIZAOS_CLOUD_API_KEY) {
    console.warn(
      "⚠️  ELIZAOS_CLOUD_API_KEY not found in .env file. Tests may fail.",
    );
  }
});
