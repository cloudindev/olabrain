"""Text chat runtime: same agent brain as voice (instructions, LLM adapter, tools), streamed
as Server-Sent Events. apps/web owns persistence; this service only thinks and calls tools.

Run:  uv run python -m brainagent_agent.chat_server
"""

from __future__ import annotations

import contextlib
import hmac
import json
import logging
import os
import time
from collections.abc import AsyncIterator
from typing import Any

from dotenv import load_dotenv
from livekit.agents import llm
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from .agent_runtime import RuntimeAgent, ToolBridge, build_agent_llm, build_function_tools
from .config import load_lab_config
from .connector_client import ConnectorClient, ConnectorError

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".env"))
load_dotenv()

logger = logging.getLogger("brainagent.chat")
MAX_HISTORY = 40


def _sse(event: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode()


async def run_chat(
    agent: RuntimeAgent,
    bridge: ToolBridge,
    model: llm.LLM,
    history: list[dict[str, str]],
) -> AsyncIterator[dict[str, Any]]:
    """Streams deltas and tool events; loops while the model asks for tools."""
    ctx = llm.ChatContext()
    ctx.add_message(role="system", content=agent.instructions)
    for msg in history[-MAX_HISTORY:]:
        content = str(msg.get("content", ""))[:20_000]
        if msg.get("role") == "assistant":
            ctx.add_message(role="assistant", content=content)
        else:
            bridge.user_message_received()
            ctx.add_message(role="user", content=content)

    tools = build_function_tools(bridge)
    started = time.perf_counter()
    first_token_ms: int | None = None
    full_text = ""
    usage = {"prompt_tokens": 0, "completion_tokens": 0}

    for _step in range(agent.max_tool_steps + 1):
        tool_calls: list[llm.FunctionToolCall] = []
        step_text = ""
        async with model.chat(chat_ctx=ctx, tools=tools or None) as stream:
            async for chunk in stream:
                if chunk.usage:
                    usage["prompt_tokens"] += chunk.usage.prompt_tokens
                    usage["completion_tokens"] += chunk.usage.completion_tokens
                if not chunk.delta:
                    continue
                if chunk.delta.content:
                    if first_token_ms is None:
                        first_token_ms = round((time.perf_counter() - started) * 1000)
                    step_text += chunk.delta.content
                    yield {"type": "delta", "text": chunk.delta.content}
                if chunk.delta.tool_calls:
                    tool_calls.extend(chunk.delta.tool_calls)
        full_text += step_text

        if not tool_calls:
            break
        if step_text:
            ctx.add_message(role="assistant", content=step_text)
        for call in tool_calls:
            try:
                args = json.loads(call.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            yield {"type": "tool_call", "name": call.name, "args": args}
            output = await bridge.call(call.name, args if isinstance(args, dict) else {})
            last = bridge.calls[-1] if bridge.calls else {}
            yield {
                "type": "tool_result",
                "name": call.name,
                "status": last.get("status"),
                "durationMs": last.get("durationMs"),
            }
            ctx.insert(
                llm.FunctionCall(
                    call_id=call.call_id, name=call.name, arguments=call.arguments or "{}"
                )
            )
            ctx.insert(
                llm.FunctionCallOutput(
                    call_id=call.call_id,
                    name=call.name,
                    output=output,
                    is_error=output.startswith("ERROR:"),
                )
            )
    else:
        yield {
            "type": "delta",
            "text": "\n(He alcanzado el máximo de pasos con herramientas en este turno.)",
        }

    yield {
        "type": "done",
        "text": full_text,
        "firstTokenMs": first_token_ms,
        "totalMs": round((time.perf_counter() - started) * 1000),
        "usage": usage,
        "toolCalls": bridge.calls,
        "model": agent.model_id,
    }


async def chat_endpoint(request: Request) -> StreamingResponse | JSONResponse:
    token = os.environ.get("CONNECTOR_SERVICE_TOKEN", "")
    header = request.headers.get("authorization", "")
    if not token or not hmac.compare_digest(header, f"Bearer {token}"):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    body = await request.json()
    tenant_id = str(body.get("tenantId", ""))
    agent_id = str(body.get("agentId", ""))
    conversation_id = body.get("conversationId")
    history = body.get("messages") or []
    if not tenant_id or not agent_id or not isinstance(history, list) or not history:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    client: ConnectorClient = request.app.state.connector
    try:
        cfg = await client.agent_config(tenant_id, agent_id)
    except ConnectorError:
        return JSONResponse({"error": "agent_not_found"}, status_code=404)

    agent = RuntimeAgent.from_config(tenant_id, cfg)
    bridge = ToolBridge(client=client, agent=agent, conversation_id=conversation_id, channel="chat")
    fallback = load_lab_config(None).llm

    async def events() -> AsyncIterator[bytes]:
        try:
            model = build_agent_llm(agent, fallback)
            async for event in run_chat(agent, bridge, model, history):
                yield _sse(event)
        except Exception as exc:  # surfaced to the chat UI, details in logs
            logger.exception("chat failed")
            yield _sse({"type": "error", "message": str(exc)[:500]})

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"cache-control": "no-cache"}
    )


async def health(_: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


def create_app(connector: ConnectorClient | None = None) -> Starlette:
    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        app.state.connector = connector or ConnectorClient()
        try:
            yield
        finally:
            await app.state.connector.aclose()

    return Starlette(
        routes=[Route("/health", health), Route("/v1/chat", chat_endpoint, methods=["POST"])],
        lifespan=lifespan,
    )


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.environ.get("AGENT_CHAT_PORT", "4200")))
