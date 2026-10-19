from typing import Any

import pytest
from starlette.testclient import TestClient

from brainagent_agent.agent_runtime import (
    AI_DISCLOSURE,
    RuntimeAgent,
    ToolBridge,
    build_function_tools,
    llm_config_for,
)
from brainagent_agent.chat_server import create_app
from brainagent_agent.config import LLMConfig

CONFIG = {
    "agent": {
        "id": "agent-1",
        "name": "Hugo",
        "instructions": "Trabajas para Talleres Ruiz.",
        "model": "anthropic:claude-haiku-5-5",
        "policy": {"maxToolSteps": 3},
    },
    "persona": {
        "name": "Hugo",
        "greeting": "Hola, soy Hugo.",
        "basePrompt": "Eres Hugo, de operaciones.",
        "voiceProvider": "elevenlabs",
        "voiceRef": "voice-hugo",
    },
    "tools": [
        {
            "name": "cerrar_parte",
            "description": "Cierra un parte",
            "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}},
            "mode": "write",
        }
    ],
}


class FakeConnector:
    async def aclose(self) -> None:
        pass

    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = responses
        self.calls: list[dict[str, Any]] = []

    async def call_tool(
        self, tenant_id, agent_id, conversation_id, name, args, confirmation_id=None, confirm=False
    ):  # noqa: ANN001,E501
        self.calls.append(
            {"name": name, "args": args, "confirmation_id": confirmation_id, "confirm": confirm}
        )
        return self.responses.pop(0)


def test_instructions_combine_persona_agent_disclosure_and_tool_guidance() -> None:
    agent = RuntimeAgent.from_config("t-1", CONFIG)
    assert agent.instructions.startswith("Eres Hugo, de operaciones.")
    assert "Talleres Ruiz" in agent.instructions
    assert AI_DISCLOSURE in agent.instructions
    assert "confirmación" in agent.instructions
    assert agent.greeting == "Hola, soy Hugo."
    assert agent.voice_ref == "voice-hugo"
    assert agent.max_tool_steps == 3


def test_model_id_maps_to_llm_config_with_fallback() -> None:
    fallback = LLMConfig(provider="google", model="g", route="direct")
    assert llm_config_for("anthropic:claude-haiku-5-5", fallback) == LLMConfig(
        provider="anthropic", model="claude-haiku-5-5", route="direct"
    )
    assert llm_config_for(None, fallback) is fallback
    assert llm_config_for("unknown:x", fallback) is fallback


async def test_voice_bridge_sends_confirmation_only_after_a_new_user_turn() -> None:
    fake = FakeConnector(
        [
            {"status": "needs_confirmation", "confirmationId": "c-1", "summary": "cerrar_parte"},
            {"status": "needs_confirmation", "confirmationId": "c-2", "summary": "cerrar_parte"},
            {"status": "ok", "result": {"cerrado": True}, "durationMs": 12},
        ]
    )
    agent = RuntimeAgent.from_config("t-1", CONFIG)
    bridge = ToolBridge(client=fake, agent=agent, conversation_id="conv", channel="voice")  # type: ignore[arg-type]
    bridge.user_message_received()

    first = await bridge.call("cerrar_parte", {"id": 7})
    assert "PENDIENTE DE CONFIRMACIÓN" in first
    # Same turn: the LLM retries immediately → no confirmation id is sent.
    await bridge.call("cerrar_parte", {"id": 7})
    assert fake.calls[1]["confirmation_id"] is None

    bridge.user_message_received()  # the user says "sí"
    result = await bridge.call("cerrar_parte", {"id": 7})
    assert fake.calls[2]["confirmation_id"] == "c-2"
    assert '"cerrado": true' in result


async def test_chat_bridge_delegates_confirmation_to_the_connector() -> None:
    fake = FakeConnector([{"status": "error", "error": "boom", "durationMs": 1}])
    agent = RuntimeAgent.from_config("t-1", CONFIG)
    bridge = ToolBridge(client=fake, agent=agent, conversation_id="conv", channel="chat")  # type: ignore[arg-type]
    assert (await bridge.call("cerrar_parte", {"id": 1})) == "ERROR: boom"
    assert fake.calls[0]["confirm"] is True
    assert bridge.calls[0]["status"] == "error"


def test_function_tools_use_the_connector_schema() -> None:
    agent = RuntimeAgent.from_config("t-1", CONFIG)
    tools = build_function_tools(
        ToolBridge(client=FakeConnector([]), agent=agent, conversation_id=None)
    )  # type: ignore[arg-type]
    assert len(tools) == 1
    info = tools[0].info  # type: ignore[union-attr]
    assert info.name == "cerrar_parte"
    assert info.raw_schema["parameters"]["properties"]["id"]["type"] == "integer"


@pytest.fixture
def chat_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CONNECTOR_SERVICE_TOKEN", "t" * 64)
    return TestClient(create_app(connector=FakeConnector([])))  # type: ignore[arg-type]


def test_chat_endpoint_requires_the_service_token(chat_client: TestClient) -> None:
    with chat_client as client:
        assert client.post("/v1/chat", json={}).status_code == 401
        bad = client.post("/v1/chat", json={}, headers={"authorization": "Bearer " + "t" * 64})
        assert bad.status_code == 400
