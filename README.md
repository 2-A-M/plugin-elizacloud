# ElizaOS Cloud Services Plugin

This plugin provides integration with ElizaOS Cloud's models.

## Usage

Add the plugin to your character configuration:

```json
"plugins": ["@elizaos-plugins/plugin-services"]
```

## Configuration

The plugin requires these environment variables (can be set in .env file or character settings):

```json
"settings": {
  "ELIZAOS_API_KEY": "your_ELIZAOS_API_KEY",
  "ELIZAOS_BASE_URL": "optional_custom_endpoint",
  "ELIZAOS_SMALL_MODEL": "gpt-4o-mini",
  "ELIZAOS_LARGE_MODEL": "gpt-4o",
  "ELIZAOS_EMBEDDING_MODEL": "text-embedding-3-small",
  "ELIZAOS_EMBEDDING_API_KEY": "your_ELIZAOS_API_KEY_for_embedding",
  "ELIZAOS_EMBEDDING_URL": "optional_custom_endpoint",
  "ELIZAOS_EMBEDDING_DIMENSIONS": "1536",
  "ELIZAOS_IMAGE_DESCRIPTION_MODEL": "gpt-4o-mini",
  "ELIZAOS_IMAGE_DESCRIPTION_MAX_TOKENS": "8192",
  "ELIZAOS_EXPERIMENTAL_TELEMETRY": "false",
  "ELIZAOS_BROWSER_BASE_URL": "https://your-proxy.example.com/openai",
  "ELIZAOS_BROWSER_EMBEDDING_URL": "https://your-proxy.example.com/openai"
}
```

Or in `.env` file:

```
ELIZAOS_API_KEY=your_ELIZAOS_API_KEY
# Optional overrides:
ELIZAOS_BASE_URL=optional_custom_endpoint
ELIZAOS_SMALL_MODEL=gpt-4o-mini
ELIZAOS_LARGE_MODEL=gpt-4o
ELIZAOS_EMBEDDING_MODEL=text-embedding-3-small
ELIZAOS_EMBEDDING_API_KEY=your_ELIZAOS_API_KEY_for_embedding
ELIZAOS_EMBEDDING_URL=optional_custom_endpoint
ELIZAOS_EMBEDDING_DIMENSIONS=1536
ELIZAOS_IMAGE_DESCRIPTION_MODEL=gpt-4o-mini
ELIZAOS_IMAGE_DESCRIPTION_MAX_TOKENS=8192
ELIZAOS_EXPERIMENTAL_TELEMETRY=false
# Browser proxy (frontend builds only)
ELIZAOS_BROWSER_BASE_URL=https://your-proxy.example.com/openai
ELIZAOS_BROWSER_EMBEDDING_URL=https://your-proxy.example.com/openai
```

### Configuration Options

- `ELIZAOS_API_KEY` (required): Your OpenAI API credentials
- `ELIZAOS_BASE_URL`: Custom API endpoint (default: https://api.openai.com/v1)
- `ELIZAOS_SMALL_MODEL`: Defaults to GPT-4o Mini ("gpt-4o-mini")
- `ELIZAOS_LARGE_MODEL`: Defaults to GPT-4o ("gpt-4o")
- `ELIZAOS_EMBEDDING_MODEL`: Defaults to text-embedding-3-small ("text-embedding-3-small")
- `ELIZAOS_EMBEDDING_API_KEY`: Custom embedding api key (defaults to `ELIZAOS_API_KEY`)
- `ELIZAOS_EMBEDDING_URL`: Custom embedding endpoint (defaults to `ELIZAOS_BASE_URL`)
- `ELIZAOS_EMBEDDING_DIMENSIONS`: Defaults to 1536 (1536)
- `ELIZAOS_IMAGE_DESCRIPTION_MODEL`: Model used for image description (default: "gpt-4o-mini")
- `ELIZAOS_IMAGE_DESCRIPTION_MAX_TOKENS`: Maximum tokens for image descriptions (default: 8192)
- `ELIZAOS_EXPERIMENTAL_TELEMETRY`: Enable experimental telemetry features for enhanced debugging and usage analytics (default: false)
- `ELIZAOS_BROWSER_BASE_URL`: Browser-only base URL to a proxy endpoint that forwards requests to OpenAI without exposing keys
- `ELIZAOS_BROWSER_EMBEDDING_URL`: Browser-only embeddings endpoint base URL

### Browser mode and proxying

When bundled for the browser, this plugin avoids sending Authorization headers. Set `ELIZAOS_BROWSER_BASE_URL` (and optionally `ELIZAOS_BROWSER_EMBEDDING_URL`) to a server-side proxy you control that injects the OpenAI API key. This prevents exposing secrets in frontend builds.

Example minimal proxy (Express):

```ts
import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

app.post('/openai/*', async (req, res) => {
  const url = `https://api.openai.com/v1/${req.params[0]}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ELIZAOS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req.body),
  });
  res.status(r.status).set(Object.fromEntries(r.headers)).send(await r.text());
});

app.listen(3000);
```

### Experimental Telemetry

When `ELIZAOS_EXPERIMENTAL_TELEMETRY` is set to `true`, the plugin enables advanced telemetry features that provide:

- Enhanced debugging capabilities for model performance issues
- Detailed usage analytics for optimization
- Better observability into OpenAI API interactions
- Foundation for future monitoring and analytics features through Sentry or other frameworks

**Note**: This feature is opt-in due to privacy considerations, as telemetry data may contain information about model usage patterns. Enable only when you need enhanced debugging or analytics capabilities.

The plugin provides these model classes:

- `TEXT_SMALL`: Optimized for fast, cost-effective responses
- `TEXT_LARGE`: For complex tasks requiring deeper reasoning
- `TEXT_EMBEDDING`: Text embedding model (text-embedding-3-small by default)
- `IMAGE`: DALL-E image generation
- `IMAGE_DESCRIPTION`: GPT-4o image analysis
- `TRANSCRIPTION`: Whisper audio transcription
- `TEXT_TOKENIZER_ENCODE`: Text tokenization
- `TEXT_TOKENIZER_DECODE`: Token decoding

## Additional Features

### Image Generation

```js
await runtime.useModel(ModelType.IMAGE, {
  prompt: "A sunset over mountains",
  n: 1, // number of images
  size: "1024x1024", // image resolution
});
```

### Audio Transcription

```js
const transcription = await runtime.useModel(
  ModelType.TRANSCRIPTION,
  audioBuffer
);
```

### Image Analysis

```js
const { title, description } = await runtime.useModel(
  ModelType.IMAGE_DESCRIPTION,
  "https://example.com/image.jpg"
);
```

### Text Embeddings

```js
await runtime.useModel(ModelType.TEXT_EMBEDDING, "text to embed");
```

### Tokenizer in browser

js-tiktoken is WASM and browser-safe; this plugin uses `encodingForModel` directly in both Node and browser builds.
