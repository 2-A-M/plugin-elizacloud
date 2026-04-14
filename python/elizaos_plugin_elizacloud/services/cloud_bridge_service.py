"""CloudBridgeService — WebSocket bridge to cloud agents. NOT YET IMPLEMENTED."""

from __future__ import annotations

import logging
from collections.abc import Callable

from elizaos_plugin_elizacloud.services.cloud_auth_service import CloudAuthService
from elizaos_plugin_elizacloud.types.cloud import (
    BridgeConnection,
    BridgeConnectionState,
    BridgeMessage,
)

logger = logging.getLogger("elizacloud.bridge")

BridgeMessageHandler = Callable[[BridgeMessage], None]

_NOT_IMPLEMENTED_MSG = "CloudBridgeService requires a WebSocket backend. See docs for setup."


class CloudBridgeService:
    """NOT YET IMPLEMENTED. All methods raise NotImplementedError."""

    service_type = "CLOUD_BRIDGE"

    def __init__(self) -> None:
        self._auth_service: CloudAuthService | None = None

    async def start(self, auth_service: CloudAuthService) -> None:  # noqa: ARG002
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def stop(self) -> None:
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    # ─── Connection Management ─────────────────────────────────────────────

    async def connect(self, container_id: str) -> None:  # noqa: ARG002
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def disconnect(self, container_id: str) -> None:  # noqa: ARG002
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    # ─── Messaging ─────────────────────────────────────────────────────────

    async def send_request(
        self,
        container_id: str,  # noqa: ARG002
        method: str,  # noqa: ARG002
        params: dict[str, object],  # noqa: ARG002
        timeout_ms: int = 60_000,  # noqa: ARG002
    ) -> object:
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def send_notification(
        self,
        container_id: str,  # noqa: ARG002
        method: str,  # noqa: ARG002
        params: dict[str, object],  # noqa: ARG002
    ) -> None:
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def send_chat_message(
        self,
        container_id: str,  # noqa: ARG002
        text: str,  # noqa: ARG002
        room_id: str | None = None,  # noqa: ARG002
        metadata: dict[str, object] | None = None,  # noqa: ARG002
    ) -> dict[str, object]:
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def get_agent_status(self, container_id: str) -> dict[str, object]:  # noqa: ARG002
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def update_agent_config(
        self,
        container_id: str,  # noqa: ARG002
        config: dict[str, object],  # noqa: ARG002
    ) -> None:
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    # ─── Event Handlers ────────────────────────────────────────────────────

    def on_message(
        self,
        container_id: str,  # noqa: ARG002
        handler: BridgeMessageHandler,  # noqa: ARG002
    ) -> Callable[[], None]:
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    # ─── Accessors ─────────────────────────────────────────────────────────

    def get_connection_state(self, container_id: str) -> BridgeConnectionState:  # noqa: ARG002
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def get_connection_info(self, container_id: str) -> BridgeConnection | None:  # noqa: ARG002
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def get_connected_container_ids(self) -> list[str]:
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)
