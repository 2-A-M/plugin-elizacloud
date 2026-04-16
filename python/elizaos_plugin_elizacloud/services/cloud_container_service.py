"""CloudContainerService — Container lifecycle through ElizaCloud API."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import cast

from elizaos_plugin_elizacloud.services.cloud_auth_service import CloudAuthService
from elizaos_plugin_elizacloud.types.cloud import (
    DEFAULT_CLOUD_CONFIG,
    CloudContainer,
    ContainerArchitecture,
    ContainerBillingStatus,
    ContainerHealthResponse,
    ContainerStatus,
    CreateContainerRequest,
    CreateContainerResponse,
    PollingInfo,
)
from elizaos_plugin_elizacloud.utils.cloud_api import CloudApiClient

logger = logging.getLogger("elizacloud.container")


def _as_str(value: object, default: str = "") -> str:
    return value if isinstance(value, str) else default


def _as_optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _as_int(value: object, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return default
    return default


def _as_float(value: object, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return default
    return default


def _as_string_dict(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}

    result: dict[str, str] = {}
    for key, raw in value.items():
        if isinstance(key, str) and isinstance(raw, str):
            result[key] = raw
    return result


def _as_object_dict(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}

    return {key: raw for key, raw in value.items() if isinstance(key, str)}


def _as_object_list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _as_container_status(value: object) -> ContainerStatus:
    if value in ("pending", "building", "deploying", "running", "stopped", "failed", "suspended"):
        return cast(ContainerStatus, value)
    return "pending"


def _as_container_architecture(value: object) -> ContainerArchitecture:
    if value in ("arm64", "x86_64"):
        return cast(ContainerArchitecture, value)
    return "arm64"


def _as_billing_status(value: object) -> ContainerBillingStatus:
    if value in ("active", "warning", "suspended", "shutdown_pending", "archived"):
        return cast(ContainerBillingStatus, value)
    return "active"


def _parse_container(data: dict[str, object]) -> CloudContainer:
    return CloudContainer(
        id=_as_str(data.get("id")),
        name=_as_str(data.get("name")),
        project_name=_as_str(data.get("project_name")),
        description=_as_optional_str(data.get("description")),
        organization_id=_as_str(data.get("organization_id")),
        user_id=_as_str(data.get("user_id")),
        status=_as_container_status(data.get("status", "pending")),
        image_tag=_as_optional_str(data.get("image_tag")),
        port=_as_int(data.get("port", 3000), 3000),
        desired_count=_as_int(data.get("desired_count", 1), 1),
        cpu=_as_int(data.get("cpu", 1792), 1792),
        memory=_as_int(data.get("memory", 1792), 1792),
        architecture=_as_container_architecture(data.get("architecture", "arm64")),
        environment_vars=_as_string_dict(data.get("environment_vars")),
        health_check_path=_as_str(data.get("health_check_path", "/health"), "/health"),
        load_balancer_url=_as_optional_str(data.get("load_balancer_url")),
        ecr_repository_uri=_as_optional_str(data.get("ecr_repository_uri")),
        ecr_image_tag=_as_optional_str(data.get("ecr_image_tag")),
        cloudformation_stack_name=_as_optional_str(data.get("cloudformation_stack_name")),
        billing_status=_as_billing_status(data.get("billing_status", "active")),
        total_billed=_as_str(data.get("total_billed", "0"), "0"),
        last_deployed_at=_as_optional_str(data.get("last_deployed_at")),
        last_health_check=_as_optional_str(data.get("last_health_check")),
        deployment_log=_as_optional_str(data.get("deployment_log")),
        error_message=_as_optional_str(data.get("error_message")),
        metadata=_as_object_dict(data.get("metadata")),
        created_at=_as_str(data.get("created_at")),
        updated_at=_as_str(data.get("updated_at")),
    )


class CloudContainerService:
    service_type = "CLOUD_CONTAINER"

    def __init__(self) -> None:
        self._auth_service: CloudAuthService | None = None
        self._tracked: dict[str, CloudContainer] = {}
        self._container_defaults = DEFAULT_CLOUD_CONFIG.container

    async def start(self, auth_service: CloudAuthService) -> None:
        self._auth_service = auth_service
        if not auth_service.is_authenticated():
            logger.warning("[CloudContainer] CloudAuthService not authenticated")
            return

        # Load existing containers
        containers = await self.list_containers()
        for c in containers:
            self._tracked[c.id] = c
        logger.info("[CloudContainer] Loaded %d existing container(s)", len(containers))

    async def stop(self) -> None:
        self._tracked.clear()

    def _get_client(self) -> CloudApiClient:
        if not self._auth_service:
            raise RuntimeError("CloudContainerService not initialized")
        return self._auth_service.get_client()

    # ─── CRUD ───────────────────────────────────────────────────────────────

    async def create_container(self, request: CreateContainerRequest) -> CreateContainerResponse:
        client = self._get_client()
        defs = self._container_defaults

        payload: dict[str, object] = {
            "name": request.name,
            "project_name": request.project_name,
            "description": request.description,
            "port": request.port or defs.default_port,
            "desired_count": request.desired_count or 1,
            "cpu": request.cpu or defs.default_cpu,
            "memory": request.memory or defs.default_memory,
            "environment_vars": request.environment_vars or {},
            "health_check_path": request.health_check_path or "/health",
            "ecr_image_uri": request.ecr_image_uri,
            "ecr_repository_uri": request.ecr_repository_uri,
            "image_tag": request.image_tag,
            "architecture": request.architecture or defs.default_architecture,
        }

        resp = await client.post("/containers", payload)
        raw_data = resp.get("data", {})
        if not isinstance(raw_data, dict):
            raw_data = {}
        container = _parse_container(raw_data)
        self._tracked[container.id] = container

        raw_polling = resp.get("polling", {})
        if not isinstance(raw_polling, dict):
            raw_polling = {}
        polling = PollingInfo(
            endpoint=_as_str(raw_polling.get("endpoint")),
            interval_ms=_as_int(raw_polling.get("intervalMs", 10000), 10000),
            expected_duration_ms=_as_int(raw_polling.get("expectedDurationMs", 600000), 600000),
        )

        result = CreateContainerResponse(
            success=bool(resp.get("success")),
            data=container,
            message=str(resp.get("message", "")),
            credits_deducted=_as_float(resp.get("creditsDeducted", 0)),
            credits_remaining=_as_float(resp.get("creditsRemaining", 0)),
            stack_name=str(resp.get("stackName", "")),
            polling=polling,
        )

        logger.info(
            '[CloudContainer] Created container "%s" (id=%s, stack=%s)',
            request.name,
            container.id,
            result.stack_name,
        )
        return result

    async def list_containers(self) -> list[CloudContainer]:
        client = self._get_client()
        resp = await client.get("/containers")
        raw_list = _as_object_list(resp.get("data", []))
        return [_parse_container(c) for c in raw_list if isinstance(c, dict)]

    async def get_container(self, container_id: str) -> CloudContainer:
        client = self._get_client()
        resp = await client.get(f"/containers/{container_id}")
        raw_data = resp.get("data", {})
        if not isinstance(raw_data, dict):
            raw_data = {}
        container = _parse_container(raw_data)
        self._tracked[container_id] = container
        return container

    async def delete_container(self, container_id: str) -> None:
        client = self._get_client()
        await client.delete(f"/containers/{container_id}")
        self._tracked.pop(container_id, None)
        logger.info("[CloudContainer] Deleted container %s", container_id)

    # ─── Deployment Polling ────────────────────────────────────────────────

    async def wait_for_deployment(
        self,
        container_id: str,
        timeout_s: float = 900.0,
    ) -> CloudContainer:
        """Poll until container is running. Exponential backoff, 15min default timeout."""
        deadline = time.monotonic() + timeout_s
        interval = 5.0
        max_interval = 30.0

        while time.monotonic() < deadline:
            container = await self.get_container(container_id)

            if container.status == "running":
                return container
            if container.status == "failed":
                raise RuntimeError(
                    f"Container deployment failed: {container.error_message or 'unknown error'}"
                )
            if container.status in ("stopped", "suspended"):
                raise RuntimeError(f"Container reached terminal state: {container.status}")

            await asyncio.sleep(interval)
            interval = min(interval * 1.5, max_interval)

        raise TimeoutError(f"Container deployment timed out after {timeout_s}s")

    # ─── Health Monitoring ─────────────────────────────────────────────────

    async def get_container_health(self, container_id: str) -> ContainerHealthResponse:
        client = self._get_client()
        resp = await client.get(f"/containers/{container_id}/health")
        raw_data = resp.get("data", {})
        if not isinstance(raw_data, dict):
            raw_data = {}
        from elizaos_plugin_elizacloud.types.cloud import ContainerHealthData

        health_data = ContainerHealthData(
            status=_as_str(raw_data.get("status")),
            healthy=bool(raw_data.get("healthy", False)),
            last_check=_as_optional_str(raw_data.get("lastCheck")),
            uptime=(
                _as_int(raw_data.get("uptime"), 0) if raw_data.get("uptime") is not None else None
            ),
        )
        return ContainerHealthResponse(
            success=bool(resp.get("success")),
            data=health_data,
        )

    # ─── Accessors ─────────────────────────────────────────────────────────

    def get_tracked_containers(self) -> list[CloudContainer]:
        return list(self._tracked.values())

    def get_tracked_container(self, container_id: str) -> CloudContainer | None:
        return self._tracked.get(container_id)

    def is_container_running(self, container_id: str) -> bool:
        c = self._tracked.get(container_id)
        return c is not None and c.status == "running"

    def get_container_url(self, container_id: str) -> str | None:
        c = self._tracked.get(container_id)
        return c.load_balancer_url if c else None
