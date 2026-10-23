"""Client for apps/connector (Tool Router). The runtime never sees credentials."""

from __future__ import annotations

import os
from typing import Any

import httpx


class ConnectorError(RuntimeError):
    pass


class ConnectorClient:
    def __init__(self, base_url: str | None = None, token: str | None = None) -> None:
        self._base_url = (
            base_url or os.environ.get("CONNECTOR_URL") or "http://127.0.0.1:4100"
        ).rstrip("/")
        self._token = token or os.environ.get("CONNECTOR_SERVICE_TOKEN") or ""
        if not self._token:
            raise ConnectorError("CONNECTOR_SERVICE_TOKEN is not set")
        # Tool calls have their own timeouts in the connector; this is a safety net.
        self._http = httpx.AsyncClient(
            base_url=self._base_url, timeout=httpx.Timeout(70.0, connect=5.0)
        )

    def _headers(self, tenant_id: str) -> dict[str, str]:
        return {"authorization": f"Bearer {self._token}", "x-tenant-id": tenant_id}

    async def agent_config(
        self, tenant_id: str, agent_id: str, contact_id: str | None = None
    ) -> dict[str, Any]:
        res = await self._http.get(
            f"/v1/agents/{agent_id}/config",
            params={"contactId": contact_id} if contact_id else None,
            headers=self._headers(tenant_id),
        )
        if res.status_code == 404:
            raise ConnectorError("agent not found")
        res.raise_for_status()
        return res.json()

    async def call_tool(
        self,
        tenant_id: str,
        agent_id: str,
        conversation_id: str | None,
        tool_name: str,
        args: dict[str, Any],
        confirmation_id: str | None = None,
        confirm: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "agentId": agent_id,
            "conversationId": conversation_id,
            "toolName": tool_name,
            "args": args,
        }
        if confirmation_id:
            payload["confirmationId"] = confirmation_id
        if confirm:
            payload["confirm"] = True
        res = await self._http.post(
            "/v1/tools/call", json=payload, headers=self._headers(tenant_id)
        )
        if res.status_code >= 500:
            return {
                "status": "error",
                "error": "El servicio de herramientas no está disponible.",
                "durationMs": 0,
            }
        res.raise_for_status()
        return res.json()

    async def add_memories(
        self,
        tenant_id: str,
        contact_id: str,
        items: list[dict[str, str]],
        conversation_id: str | None,
    ) -> dict[str, Any]:
        res = await self._http.post(
            f"/v1/contacts/{contact_id}/memories",
            json={"items": items, "conversationId": conversation_id},
            headers=self._headers(tenant_id),
        )
        res.raise_for_status()
        return res.json()

    async def add_messages(
        self, tenant_id: str, conversation_id: str, items: list[dict[str, str]]
    ) -> None:
        res = await self._http.post(
            f"/v1/conversations/{conversation_id}/messages",
            json={"items": items},
            headers=self._headers(tenant_id),
        )
        res.raise_for_status()

    async def end_conversation(self, tenant_id: str, conversation_id: str) -> None:
        res = await self._http.post(
            f"/v1/conversations/{conversation_id}/end",
            json={},
            headers=self._headers(tenant_id),
        )
        res.raise_for_status()

    async def aclose(self) -> None:
        await self._http.aclose()
