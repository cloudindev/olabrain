"""Turns an agent's configuration (persona + instructions + model + tools) into what both
the voice worker and the text chat need: system instructions, an LLM and function tools.

Write confirmations (CLAUDE.md §5): when the Tool Router answers `needs_confirmation`, the
LLM is told to ask the user. The write only runs when the same tool is called again with
the same arguments *after a new user message*, so the LLM can't confirm on its own:
- voice: the bridge keeps the confirmation id in memory and checks the user turn count;
- text chat: each message is a separate request, so the bridge sends `confirm` and the
  connector checks the stored conversation for a user message after the request.
"""

from __future__ import annotations

import contextlib
import json
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from livekit.agents import function_tool, llm

from .config import LLMConfig
from .connector_client import ConnectorClient
from .memory import memory_section
from .providers import build_llm

AI_DISCLOSURE = (
    "Eres un agente de inteligencia artificial. Si te preguntan si eres una persona, "
    "di con naturalidad que eres una IA."
)

MEMORY_TOOL_GUIDANCE = (
    "Si la persona te pide que recuerdes algo, o te da un dato duradero importante "
    "(cómo quiere que la llamen, cuándo prefiere que la contacten…), guárdalo con la "
    "herramienta recordar_dato."
)

TOOL_GUIDANCE = (
    "Tus herramientas definen lo que puedes hacer: si te piden algo y tienes una herramienta "
    "para ello, úsala aunque no forme parte de tu especialidad o de tu personaje. Nunca digas "
    "que no puedes hacer algo para lo que tienes una herramienta; si una herramienta falla, "
    "explica el error. "
    "Antes de llamar a una herramienta, di en voz alta una frase muy corta como «Un momento, "
    "lo miro» para que la persona no espere en silencio. "
    "Usa las herramientas disponibles para consultar datos reales en lugar de suponer. "
    "Si una herramienta devuelve un error, explícalo con palabras sencillas. "
    "Antes de ejecutar una acción que modifica datos, el sistema te pedirá confirmación: "
    "explica al usuario exactamente qué vas a hacer y pregúntale si quiere continuar. "
    "Solo si responde que sí, vuelve a llamar a la herramienta con los mismos argumentos."
)


WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MONTHS = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]


def tool_inventory(tools: list[dict[str, Any]]) -> str:
    """Names of the agent's tools, so the model knows its reach beyond its persona's role."""
    names = [str(t.get("name")) for t in tools if t.get("name")]
    return f"Herramientas que tienes: {', '.join(names)}." if names else ""


def date_context(now: datetime | None = None, tz: str | None = None) -> str:
    """Today's date for the system prompt. Date only (no time) so the prompt prefix stays
    stable for a whole day and provider prompt caching keeps working."""
    zone = ZoneInfo(tz or os.environ.get("AGENT_TIMEZONE") or "Europe/Madrid")
    today = (now or datetime.now(zone)).astimezone(zone)
    return (
        f"Hoy es {WEEKDAYS[today.weekday()]}, {today.day} de {MONTHS[today.month - 1]} de "
        f"{today.year} ({today.date().isoformat()}), zona horaria {zone.key}. Usa esta fecha "
        "cuando el usuario diga «hoy», «mañana» o «ayer»."
    )


def name_note(agent_name: str, persona_name: str | None) -> str:
    """The agent's own name wins over its persona's (e.g. "Claudia" built on "Alba")."""
    if not persona_name or persona_name.strip() == agent_name.strip():
        return ""
    return (
        f"Te llamas {agent_name}. Preséntate siempre como {agent_name}, nunca como {persona_name}."
    )


def role_note(role: str | None) -> str:
    """What the agent does, as the user wrote it (e.g. "Soporte", "Asistente personal")."""
    return f"Tu función: {role.strip()}." if role and role.strip() else ""


def own_greeting(greeting: str | None, agent_name: str, persona_name: str | None) -> str | None:
    """The persona's greeting with the agent's name ("Hola, soy Alba" -> "Hola, soy Claudia")."""
    if not greeting or not persona_name or persona_name == agent_name:
        return greeting
    return greeting.replace(persona_name, agent_name)


@dataclass
class RuntimeAgent:
    tenant_id: str
    agent_id: str
    name: str
    instructions: str
    model_id: str | None
    greeting: str | None
    voice_provider: str | None
    voice_ref: str | None
    tools: list[dict[str, Any]]
    persona_slug: str | None = None
    contact_id: str | None = None
    memory: list[str] = field(default_factory=list)
    max_tool_steps: int = 4

    @classmethod
    def from_config(cls, tenant_id: str, cfg: dict[str, Any]) -> RuntimeAgent:
        agent = cfg["agent"]
        persona = cfg.get("persona") or {}
        parts = [
            persona.get("basePrompt") or f"Eres {agent['name']}, un asistente de la empresa.",
            name_note(agent["name"], persona.get("name")),
            role_note(agent.get("role")),
            agent.get("instructions") or "",
            AI_DISCLOSURE,
            date_context(),
            TOOL_GUIDANCE if cfg.get("tools") else "",
            tool_inventory(cfg.get("tools") or []),
        ]
        memory_cfg = cfg.get("memory") or None
        memory_items = list(memory_cfg.get("items") or []) if memory_cfg else []
        parts.append(memory_section(memory_items))
        if memory_cfg:
            parts.append(MEMORY_TOOL_GUIDANCE)
        policy = agent.get("policy") or {}
        return cls(
            tenant_id=tenant_id,
            agent_id=agent["id"],
            name=agent["name"],
            instructions="\n\n".join(p.strip() for p in parts if p and p.strip()),
            model_id=agent.get("model"),
            greeting=own_greeting(persona.get("greeting"), agent["name"], persona.get("name")),
            voice_provider=persona.get("voiceProvider"),
            voice_ref=persona.get("voiceRef"),
            tools=cfg.get("tools") or [],
            persona_slug=persona.get("slug"),
            contact_id=memory_cfg.get("contactId") if memory_cfg else None,
            memory=memory_items,
            max_tool_steps=int(policy.get("maxToolSteps") or 4),
        )


def catalog_voice(provider: str, persona_slug: str | None) -> str | None:
    """Default voice of a catalog persona for a provider (config/catalog-voices.json)."""
    if not persona_slug:
        return None
    path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "config", "catalog-voices.json"
    )
    try:
        with open(path, encoding="utf-8") as f:
            voices = json.load(f).get(provider, {})
    except (OSError, ValueError):
        return None
    voice = voices.get(persona_slug) if isinstance(voices, dict) else None
    return voice if isinstance(voice, str) else None


def llm_config_for(model_id: str | None, fallback: LLMConfig) -> LLMConfig:
    """ "anthropic:claude-haiku-5-5" -> LLMConfig(provider, model). None -> fallback."""
    if not model_id or ":" not in model_id:
        return fallback
    provider, model = model_id.split(":", 1)
    if provider not in ("google", "openai", "anthropic"):
        return fallback
    return LLMConfig(provider=provider, model=model, route=fallback.route)  # type: ignore[arg-type]


def build_agent_llm(agent: RuntimeAgent, fallback: LLMConfig) -> llm.LLM:
    return build_llm(llm_config_for(agent.model_id, fallback))


def _args_key(name: str, args: dict[str, Any]) -> str:
    return f"{name}:{json.dumps(args, sort_keys=True, ensure_ascii=False)}"


@dataclass
class _Pending:
    confirmation_id: str
    user_turn: int


@dataclass
class ToolBridge:
    """Executes tools through the connector and tracks pending confirmations."""

    client: ConnectorClient
    agent: RuntimeAgent
    conversation_id: str | None
    channel: str = "voice"  # "voice" | "chat"
    user_turns: int = 0
    calls: list[dict[str, Any]] = field(default_factory=list)
    # Files a tool produced (e.g. an invoice PDF link) are shown in the conversation UI
    # instead of being read aloud: (label, url).
    on_file: Callable[[str, str], Awaitable[None]] | None = None
    _pending: dict[str, _Pending] = field(default_factory=dict)

    def user_message_received(self) -> None:
        self.user_turns += 1

    async def call(self, name: str, args: dict[str, Any]) -> str:
        key = _args_key(name, args)
        pending = self._pending.get(key)
        confirmation_id = None
        if pending and self.user_turns > pending.user_turn:
            confirmation_id = pending.confirmation_id
            del self._pending[key]

        started = time.perf_counter()
        result = await self.client.call_tool(
            self.agent.tenant_id,
            self.agent.agent_id,
            self.conversation_id,
            name,
            args,
            confirmation_id,
            confirm=self.channel == "chat",
        )
        self.calls.append(
            {
                "name": name,
                "status": result.get("status"),
                "durationMs": result.get("durationMs")
                or round((time.perf_counter() - started) * 1000),
            }
        )
        status = result.get("status")
        if status == "needs_confirmation":
            self._pending[key] = _Pending(result["confirmationId"], self.user_turns)
            return (
                "ACCIÓN PENDIENTE DE CONFIRMACIÓN. No se ha ejecutado. Explica al usuario "
                f"qué vas a hacer ({result.get('summary', name)}) y pregúntale si quiere "
                "continuar. Si lo confirma, vuelve a llamar a esta herramienta con "
                "exactamente los mismos argumentos."
            )
        if status == "error":
            return f"ERROR: {result.get('error', 'error desconocido')}"
        data = result.get("result")
        if self.on_file and isinstance(data, dict) and isinstance(data.get("pdf_url"), str):
            label = f"Factura {data.get('factura') or ''}".strip()
            # The UI hint must never break the tool call.
            with contextlib.suppress(Exception):
                await self.on_file(label, data["pdf_url"])
        payload = json.dumps(data, ensure_ascii=False, default=str)
        if result.get("truncated"):
            payload += "\n(Resultado recortado: hay más datos de los mostrados.)"
        return payload


def build_function_tools(bridge: ToolBridge) -> list[llm.Tool]:
    """One LiveKit raw function tool per connector tool (works in voice and text), plus
    `recordar_dato` when the agent remembers the contact."""
    out: list[llm.Tool] = []
    agent = bridge.agent
    if agent.contact_id:
        contact_id = agent.contact_id

        async def remember(raw_arguments: dict[str, Any]) -> str:
            fact = str((raw_arguments or {}).get("dato", "")).strip()
            if not fact:
                return "ERROR: falta el dato"
            res = await bridge.client.add_memories(
                agent.tenant_id,
                contact_id,
                [{"content": fact, "source": "explicit"}],
                bridge.conversation_id,
            )
            agent.memory.append(fact)
            return "Guardado." if res.get("added") else "Ya lo sabía."

        out.append(
            function_tool(
                remember,
                raw_schema={
                    "name": "recordar_dato",
                    "description": "Guarda un dato duradero sobre la persona para recordarlo en "
                    "futuras conversaciones (preferencias, datos de contacto, compromisos).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "dato": {
                                "type": "string",
                                "description": "Frase corta en tercera persona",
                            }
                        },
                        "required": ["dato"],
                    },
                },
            )
        )
    for spec in bridge.agent.tools:
        name = spec["name"]

        async def handler(raw_arguments: dict[str, Any], _name: str = name) -> str:
            return await bridge.call(_name, raw_arguments or {})

        schema = spec.get("inputSchema") or {"type": "object", "properties": {}}
        out.append(
            function_tool(
                handler,
                raw_schema={
                    "name": name,
                    "description": (spec.get("description") or name)[:1024],
                    "parameters": schema,
                },
            )
        )
    return out
