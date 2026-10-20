"""Memory per contact: what the agent learns about a person, kept across conversations.

- At the start, known facts are added to the instructions (`memory_section`).
- The agent can save a fact on request with the `recordar_dato` tool (explicit).
- After a chat turn or a voice call, an LLM extracts new durable facts (auto).

Only durable, useful facts are kept (name, company, preferences, pending matters); never
secrets, payment data or health data.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from livekit.agents import llm

logger = logging.getLogger("brainagent.memory")

MAX_FACTS_PER_EXTRACTION = 3

EXTRACTION_PROMPT = """Eres el módulo de memoria de un asistente de empresa. A partir de la \
conversación, extrae datos DURADEROS y ÚTILES sobre la persona que habla con el asistente, \
para recordarlos en futuras conversaciones: nombre, empresa, cargo, preferencias de contacto, \
productos o servicios que usa, asuntos pendientes y compromisos adquiridos (con fecha si la hay).

Reglas:
- Solo hechos que sigan siendo ciertos en otra conversación. Nada de saludos ni de lo efímero.
- No repitas ni reformules lo que ya está en "Ya conocido".
- Nunca guardes contraseñas, claves, datos de tarjeta o bancarios, ni datos de salud.
- Cada dato en una frase corta en tercera persona, en español.
- Máximo {max_facts} datos. Si no hay nada nuevo, devuelve una lista vacía.

Responde SOLO con JSON: {{"datos": ["...", "..."]}}"""

SENSITIVE = re.compile(
    r"contraseñ|password|\bpin\b|cvv|tarjeta de crédito|iban|\bclave\b|token", re.IGNORECASE
)


def memory_section(items: list[str]) -> str:
    if not items:
        return ""
    facts = "\n".join(f"- {item}" for item in items)
    return (
        "Lo que sabes de esta persona por conversaciones anteriores:\n"
        f"{facts}\n"
        "Úsalo con naturalidad cuando venga al caso; no lo recites ni digas de dónde lo sabes "
        "salvo que te lo pregunten."
    )


def parse_facts(text: str, known: list[str]) -> list[str]:
    """Robust JSON parsing of the extractor output; drops duplicates and sensitive facts."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    raw = data.get("datos") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []
    seen = {k.strip().lower() for k in known}
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        fact = item.strip()[:500]
        if not fact or fact.lower() in seen or SENSITIVE.search(fact):
            continue
        seen.add(fact.lower())
        out.append(fact)
        if len(out) >= MAX_FACTS_PER_EXTRACTION:
            break
    return out


def transcript_text(turns: list[dict[str, str]], limit: int = 30) -> str:
    lines = []
    for turn in turns[-limit:]:
        who = "Persona" if turn.get("role") == "user" else "Asistente"
        content = str(turn.get("content", "")).strip()
        if content:
            lines.append(f"{who}: {content[:2000]}")
    return "\n".join(lines)


async def extract_facts(model: llm.LLM, known: list[str], turns: list[dict[str, str]]) -> list[str]:
    conversation = transcript_text(turns)
    if not conversation:
        return []
    ctx = llm.ChatContext()
    ctx.add_message(
        role="system", content=EXTRACTION_PROMPT.format(max_facts=MAX_FACTS_PER_EXTRACTION)
    )
    known_text = "\n".join(f"- {k}" for k in known) or "(nada)"
    ctx.add_message(
        role="user", content=f"Ya conocido:\n{known_text}\n\nConversación:\n{conversation}"
    )
    text = ""
    async with model.chat(chat_ctx=ctx) as stream:
        async for chunk in stream:
            if chunk.delta and chunk.delta.content:
                text += chunk.delta.content
    return parse_facts(text, known)


async def remember_after(
    client: Any,
    model: llm.LLM,
    tenant_id: str,
    contact_id: str,
    conversation_id: str | None,
    known: list[str],
    turns: list[dict[str, str]],
) -> int:
    """Extracts and stores new facts. Never raises: memory must not break a conversation."""
    try:
        facts = await extract_facts(model, known, turns)
        if not facts:
            return 0
        res = await client.add_memories(
            tenant_id,
            contact_id,
            [{"content": f, "source": "auto"} for f in facts],
            conversation_id,
        )
        return int(res.get("added", 0))
    except Exception:
        logger.exception("memory extraction failed")
        return 0
