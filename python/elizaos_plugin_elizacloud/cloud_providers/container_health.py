from __future__ import annotations

from typing import TypedDict, cast

from elizaos_plugin_elizacloud.services.cloud_auth_service import CloudAuthService
from elizaos_plugin_elizacloud.services.cloud_container_service import CloudContainerService


class ProviderResult(TypedDict, total=False):
    text: str
    values: dict[str, object]
    data: dict[str, object]


class HealthReport(TypedDict):
    id: str
    name: str
    healthy: bool
    status: str
    billing: str


def _read_attr(container: object, name: str, default: object = None) -> object:
    if hasattr(container, "__dict__") and name not in vars(container):
        return default
    return getattr(container, name, default)


async def get_container_health(
    auth: CloudAuthService | None = None,
    container_svc: CloudContainerService | None = None,
) -> ProviderResult:
    if not auth or not auth.is_authenticated():
        return ProviderResult(text="")

    running = (
        [c for c in container_svc.get_tracked_containers() if c.status == "running"]
        if container_svc
        else []
    )
    if not running:
        return ProviderResult(
            text="No running containers.",
            values={"healthyContainers": 0},
        )

    # NOTE: True health would require hitting each container's health_check_path
    # endpoint over the network.  We approximate here using locally-cached state:
    # a container is considered healthy when it is running, billing is active,
    # and there is no recorded error message.
    reports: list[HealthReport] = [
        HealthReport(
            id=str(_read_attr(c, "id", "")),
            name=str(_read_attr(c, "name", "")),
            healthy=(
                _read_attr(c, "status") == "running"
                and _read_attr(c, "billing_status", "active") == "active"
                and _read_attr(c, "error_message") in (None, "")
            ),
            status=str(_read_attr(c, "status", "")),
            billing=str(_read_attr(c, "billing_status", "")),
        )
        for c in running
    ]

    healthy_count = len([r for r in reports if r["healthy"]])
    lines = [
        f"Health: {healthy_count}/{len(reports)} healthy",
        *[
            f"  - {r['name']}: {'OK' if r['healthy'] else 'UNHEALTHY'}"
            f" (status={r['status']}, billing={r['billing']})"
            for r in reports
        ],
    ]

    data: dict[str, object] = {"reports": cast(object, reports)}

    return ProviderResult(
        text="\n".join(lines),
        values={
            "healthyContainers": healthy_count,
            "unhealthyContainers": len(reports) - healthy_count,
        },
        data=data,
    )


container_health_provider: dict[str, object] = {
    "name": "elizacloud_health",
    "description": "ElizaCloud container health",
    "dynamic": True,
    "position": 92,
    "private": True,
    "get": get_container_health,
}
