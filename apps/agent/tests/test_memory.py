from typing import Any

from brainagent_agent.agent_runtime import RuntimeAgent, ToolBridge, build_function_tools
from brainagent_agent.memory import memory_section, parse_facts, transcript_text

CONFIG: dict[str, Any] = {
    "agent": {"id": "a-1", "name": "Alba", "instructions": "", "policy": {}},
    "persona": {"name": "Alba", "basePrompt": "Eres Alba.", "slug": "alba"},
    "tools": [],
    "memory": {"contactId": "c-1", "items": ["Se llama Luis", "Es CEO de Cloudin"]},
}


class FakeConnector:
    def __init__(self) -> None:
        self.saved: list[dict[str, Any]] = []

    async def add_memories(self, tenant_id, contact_id, items, conversation_id):  # noqa: ANN001
        self.saved.append({"contact": contact_id, "items": items, "conversation": conversation_id})
        return {"added": len(items)}


def test_parse_facts_handles_noise_duplicates_sensitive_data_and_limit() -> None:
    text = (
        "Claro, aquí tienes:\n"
        '{"datos": ["Se llama Luis", "Prefiere llamadas por la tarde", '
        '"Su contraseña es 1234", "Tiene 3 servidores contratados", '
        '"Usa WHMCS", "Quiere migrar en enero"]}'
    )
    facts = parse_facts(text, known=["se llama luis"])
    assert facts == [
        "Prefiere llamadas por la tarde",
        "Tiene 3 servidores contratados",
        "Usa WHMCS",
    ]


def test_parse_facts_tolerates_invalid_output() -> None:
    assert parse_facts("no hay nada nuevo", []) == []
    assert parse_facts('{"datos": "no es lista"}', []) == []
    assert parse_facts("{roto", []) == []


def test_memory_is_injected_into_instructions_with_the_remember_guidance() -> None:
    agent = RuntimeAgent.from_config("t-1", CONFIG)
    assert agent.contact_id == "c-1"
    assert "Lo que sabes de esta persona" in agent.instructions
    assert "- Es CEO de Cloudin" in agent.instructions
    assert "recordar_dato" in agent.instructions
    assert memory_section([]) == ""


def test_no_memory_without_contact() -> None:
    agent = RuntimeAgent.from_config("t-1", {**CONFIG, "memory": None})
    assert agent.contact_id is None
    assert "Lo que sabes" not in agent.instructions
    tools = build_function_tools(
        ToolBridge(client=FakeConnector(), agent=agent, conversation_id=None)
    )  # type: ignore[arg-type]
    assert tools == []


async def test_recordar_dato_tool_saves_an_explicit_fact() -> None:
    agent = RuntimeAgent.from_config("t-1", CONFIG)
    fake = FakeConnector()
    tools = build_function_tools(ToolBridge(client=fake, agent=agent, conversation_id="conv-1"))  # type: ignore[arg-type]
    remember = next(t for t in tools if t.info.name == "recordar_dato")  # type: ignore[union-attr]
    assert await remember({"dato": "Prefiere WhatsApp"}) == "Guardado."  # type: ignore[operator]
    assert fake.saved == [
        {
            "contact": "c-1",
            "items": [{"content": "Prefiere WhatsApp", "source": "explicit"}],
            "conversation": "conv-1",
        }
    ]
    assert "Prefiere WhatsApp" in agent.memory


def test_transcript_text_labels_speakers_and_skips_empty_turns() -> None:
    text = transcript_text(
        [
            {"role": "user", "content": "Hola, soy Luis"},
            {"role": "assistant", "content": ""},
            {"role": "assistant", "content": "Hola Luis"},
        ]
    )
    assert text == "Persona: Hola, soy Luis\nAsistente: Hola Luis"
