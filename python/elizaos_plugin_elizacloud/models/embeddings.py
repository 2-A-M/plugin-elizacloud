from typing import TypeGuard, cast

from elizaos_plugin_elizacloud.providers import ElizaCloudClient
from elizaos_plugin_elizacloud.types import ElizaCloudConfig, TextEmbeddingParams


def _is_single_embedding(result: list[float] | list[list[float]]) -> TypeGuard[list[float]]:
    return bool(result) and isinstance(result[0], float)


def _is_batch_embedding(
    result: list[float] | list[list[float]],
) -> TypeGuard[list[list[float]]]:
    return bool(result) and isinstance(result[0], list)


async def handle_text_embedding(
    config: ElizaCloudConfig,
    text: str,
) -> list[float]:
    async with ElizaCloudClient(config) as client:
        params = TextEmbeddingParams(text=text)
        result = await client.generate_embedding(params)
        if _is_single_embedding(result):
            return result
        return cast(list[list[float]], result)[0]


async def handle_batch_text_embedding(
    config: ElizaCloudConfig,
    texts: list[str],
) -> list[list[float]]:
    if not texts:
        return []

    async with ElizaCloudClient(config) as client:
        params = TextEmbeddingParams(texts=texts)
        result = await client.generate_embedding(params)
        if _is_batch_embedding(result):
            return result
        return [cast(list[float], result)]
