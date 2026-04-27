"""FREEZE_CLOUD_AGENT — Snapshot and stop a cloud agent."""

from __future__ import annotations

import logging

from elizaos_plugin_elizacloud.actions.provision_agent import (
    ActionResult,
    ServiceRegistry,
    _confirmation_required,
    _is_confirmed,
)

logger = logging.getLogger("elizacloud.actions.freeze")


def _get_container_id(
    message_metadata: dict[str, object] | None = None,
    options: dict[str, object] | None = None,
) -> str | None:
    if options and options.get("containerId"):
        return str(options["containerId"])
    if message_metadata:
        action_params = message_metadata.get("actionParams")
        if isinstance(action_params, dict) and action_params.get("containerId"):
            return str(action_params["containerId"])
    return None


def _get_params(
    message_metadata: dict[str, object] | None = None,
    options: dict[str, object] | None = None,
) -> dict[str, object]:
    if options:
        return options
    action_params = message_metadata.get("actionParams") if message_metadata else None
    return action_params if isinstance(action_params, dict) else {}


freeze_cloud_agent_action: dict[str, object] = {
    "name": "FREEZE_CLOUD_AGENT",
    "description": "Freeze a cloud agent: snapshot state, disconnect bridge, stop container.",
    "similes": ["freeze agent", "hibernate agent", "pause agent", "stop cloud agent"],
    "tags": ["cloud", "container", "backup"],
    "parameters": [
        {
            "name": "containerId",
            "description": "ID of the container to freeze",
            "required": True,
            "schema": {"type": "string"},
        },
        {
            "name": "confirmed",
            "description": "Must be true to freeze the cloud agent after preview",
            "required": False,
            "schema": {"type": "boolean", "default": False},
        },
    ],
}


async def validate_freeze(registry: ServiceRegistry) -> bool:
    return registry.auth is not None and registry.auth.is_authenticated()


async def handle_freeze(
    registry: ServiceRegistry,
    message_text: str = "",
    message_metadata: dict[str, object] | None = None,
    options: dict[str, object] | None = None,
) -> ActionResult:
    containers = registry.containers
    bridge = registry.bridge
    backup = registry.backup

    if not containers:
        return ActionResult(success=False, error="Container service unavailable")

    container_id = _get_container_id(message_metadata, options)
    if not container_id:
        return ActionResult(success=False, error="Missing containerId")

    container = await containers.get_container(container_id)
    if container.status != "running":
        return ActionResult(
            success=False,
            error=f"Container not running (status: {container.status})",
        )

    params = _get_params(message_metadata, options)
    preview = "\n".join(
        [
            "Confirmation required before freezing Eliza Cloud agent:",
            f"Container: {container.name}",
            f"ID: {container_id}",
            "Effects: create snapshot, disconnect bridge, stop container.",
        ]
    )
    if not _is_confirmed(params):
        return _confirmation_required(
            preview,
            {"containerId": container_id, "containerName": container.name},
        )

    # Snapshot → disconnect → stop
    snapshot_id: str | None = None
    if backup:
        snap = await backup.create_snapshot(
            container_id,
            "manual",
            {
                "trigger": "user-freeze",
                "containerName": container.name,
            },
        )
        snapshot_id = snap.id
        backup.cancel_auto_backup(container_id)

    if bridge:
        await bridge.disconnect(container_id)

    await containers.delete_container(container_id)

    return ActionResult(
        success=True,
        text=f'Agent "{container.name}" frozen',
        data={
            "containerId": container_id,
            "containerName": container.name,
            "snapshotId": snapshot_id,
        },
    )
