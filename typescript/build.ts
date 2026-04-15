#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const externalDeps = ["@elizaos/core", "@ai-sdk/openai", "ai", "js-tiktoken"];
type BunRuntime = {
  build(options: {
    entrypoints: string[];
    outdir: string;
    target: "browser" | "node";
    format: "cjs" | "esm";
    sourcemap: "external";
    minify: boolean;
    external: readonly string[];
  }): Promise<{
    success: boolean;
    logs: unknown[];
  }>;
  $(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
};

function getBunRuntime(): BunRuntime {
  const bunRuntime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  if (!bunRuntime) {
    throw new Error("plugin-elizacloud build.ts must run under Bun.");
  }
  return bunRuntime;
}

async function build() {
  const bun = getBunRuntime();
  const totalStart = Date.now();
  const distDir = join(process.cwd(), "dist");

  // Clean dist directory
  if (existsSync(distDir)) {
    await bun.$`rm -rf ${distDir}`;
  }

  await mkdir(distDir, { recursive: true });

  const nodeStart = Date.now();
  console.log("🔨 Building @elizaos/plugin-elizacloud for Node...");
  const nodeResult = await bun.build({
    entrypoints: ["index.node.ts"],
    outdir: "dist/node",
    target: "node",
    format: "esm",
    sourcemap: "external",
    minify: false,
    external: [...externalDeps, "undici"],
  });
  if (!nodeResult.success) {
    console.error(nodeResult.logs);
    throw new Error("Node build failed");
  }
  console.log(`✅ Node build complete in ${((Date.now() - nodeStart) / 1000).toFixed(2)}s`);

  const browserStart = Date.now();
  console.log("🌐 Building @elizaos/plugin-elizacloud for Browser...");
  const browserResult = await bun.build({
    entrypoints: ["index.browser.ts"],
    outdir: "dist/browser",
    target: "browser",
    format: "esm",
    sourcemap: "external",
    minify: true,
    external: [...externalDeps, "undici"],
  });
  if (!browserResult.success) {
    console.error(browserResult.logs);
    throw new Error("Browser build failed");
  }
  console.log(`✅ Browser build complete in ${((Date.now() - browserStart) / 1000).toFixed(2)}s`);

  const cjsStart = Date.now();
  console.log("🧱 Building @elizaos/plugin-elizacloud for Node (CJS)...");
  const cjsResult = await bun.build({
    entrypoints: ["index.node.ts"],
    outdir: "dist/cjs",
    target: "node",
    format: "cjs",
    sourcemap: "external",
    minify: false,
    external: [...externalDeps, "undici"],
  });
  if (!cjsResult.success) {
    console.error(cjsResult.logs);
    throw new Error("CJS build failed");
  }
  try {
    await rename("dist/cjs/index.node.js", "dist/cjs/index.node.cjs");
  } catch (e) {
    console.warn("CJS rename step warning:", e);
  }
  console.log(`✅ CJS build complete in ${((Date.now() - cjsStart) / 1000).toFixed(2)}s`);

  const dtsStart = Date.now();
  console.log("📝 Generating TypeScript declarations...");
  await bun.$`tsc --project tsconfig.build.json`;
  await mkdir("dist/node", { recursive: true });
  await mkdir("dist/browser", { recursive: true });
  await mkdir("dist/cjs", { recursive: true });
  await writeFile(
    "dist/node/index.d.ts",
    `export * from '../index';
export { default } from '../index';
`
  );
  await writeFile(
    "dist/browser/index.d.ts",
    `export * from '../index';
export { default } from '../index';
`
  );
  await writeFile(
    "dist/cjs/index.d.ts",
    `export * from '../index';
export { default } from '../index';
`
  );
  console.log(`✅ Declarations generated in ${((Date.now() - dtsStart) / 1000).toFixed(2)}s`);

  console.log(`🎉 All builds finished in ${((Date.now() - totalStart) / 1000).toFixed(2)}s`);
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
