"""CloudBridgeService — lightweight in-memory bridge state for cloud agents."""

from __future__ import annotations

import time
from collections.abc import Callable

from elizaos_plugin_elizacloud.services.cloud_auth_service import CloudAuthService
from elizaos_plugin_elizacloud.types.cloud import (
    BridgeConnection,
    BridgeConnectionState,
    BridgeMessage,
)

BridgeMessageHandler = Callable[[BridgeMessage], None]


class CloudBridgeService:
    """Track bridge connections locally for tests and offline workflows."""

    service_type = "CLOUD_BRIDGE"

    def __init__(self) -> None:
        self._auth_service: CloudAuthService | None = None
        self._connections: dict[str, BridgeConnection] = {}
        self._handlers: dict[str, set[BridgeMessageHandler]] = {}

    async def start(self, auth_service: CloudAuthService) -> None:
        self._auth_service = auth_service

    async def stop(self) -> None:
        self._connections.clear()
        self._handlers.clear()

    # ─── Connection Management ─────────────────────────────────────────────

    async def connect(self, container_id: str) -> None:
        existing = self._connections.get(container_id)
        if existing and existing.state == "connected":
            return
        now = time.time()
        self._connections[container_id] = BridgeConnection(
            container_id=container_id,
            state="connected",
            connected_at=existing.connected_at if existing else now,
            last_heartbeat=now,
            reconnect_attempts=0,
        )

    async def disconnect(self, container_id: str) -> None:
        self._connections.pop(container_id, None)

    # ─── Messaging ─────────────────────────────────────────────────────────

    def _require_connected(self, container_id: str) -> None:
        if self.get_connection_state(container_id) != "connected":
            raise RuntimeError(f"Not connected to container {container_id}")

    async def send_request(
        self,
        container_id: str,
        method: str,
        params: dict[str, object],
        timeout_ms: int = 60_000,  # noqa: ARG002
    ) -> object:
        self._require_connected(container_id)
        return {
            "containerId": container_id,
            "method": method,
            "params": params,
        }

    def send_notification(
        self, container_id: str, method: str, params: dict[str, object]
    ) -> None:
        self._require_connected(container_id)
        message = BridgeMessage(method=method, params=params)
        for handler in list(self._handlers.get(container_id, ())):
            handler(message)

    async def send_chat_message(
        self,
        container_id: str,
        text: str,
        room_id: str | None = None,
        metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        self._require_connected(container_id)
        return {
            "containerId": container_id,
            "roomId": room_id,
            "text": text,
            "metadata": metadata or {},
        }

    async def get_agent_status(self, container_id: str) -> dict[str, object]:
        self._require_connected(container_id)
        return {
            "containerId": container_id,
            "state": self.get_connection_state(container_id),
        }

    async def update_agent_config(
        self,
        container_id: str,
        config: dict[str, object],  # noqa: ARG002
    ) -> None:
        self._require_connected(container_id)

    # ─── Event Handlers ────────────────────────────────────────────────────

    def on_message(
        self,
        container_id: str,
        handler: BridgeMessageHandler,
    ) -> Callable[[], None]:
        handlers = self._handlers.setdefault(container_id, set())
        handlers.add(handler)

        def unsubscribe() -> None:
            registered = self._handlers.get(container_id)
            if not registered:
                return
            registered.discard(handler)
            if not registered:
                self._handlers.pop(container_id, None)

        return unsubscribe

    # ─── Accessors ─────────────────────────────────────────────────────────

    def get_connection_state(self, container_id: str) -> BridgeConnectionState:
        connection = self._connections.get(container_id)
        return connection.state if connection else "disconnected"

    def get_connection_info(self, container_id: str) -> BridgeConnection | None:
        return self._connections.get(container_id)

    def get_connected_container_ids(self) -> list[str]:
        return sorted(
            [
                container_id
                for container_id, connection in self._connections.items()
                if connection.state == "connected"
            ]
        )
