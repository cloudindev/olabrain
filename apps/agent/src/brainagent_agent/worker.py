"""LiveKit Agents worker for the /lab voice spike.

Run:  uv run python -m brainagent_agent.worker dev
apps/web dispatches this agent explicitly (agent_name = LIVEKIT_AGENT_NAME) and
passes the lab config as dispatch metadata.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    AgentStateChangedEvent,
    ConversationItemAddedEvent,
    ErrorEvent,
    JobContext,
    JobProcess,
    MetricsCollectedEvent,
    TurnHandlingOptions,
    UserStateChangedEvent,
    cli,
    inference,
    llm,
)
from livekit.agents.worker import ServerEnvOption
from livekit.plugins import silero

from .agent_runtime import (
    RuntimeAgent,
    ToolBridge,
    build_agent_llm,
    build_function_tools,
    catalog_voice,
)
from .config import InvalidLabConfig, LabConfig, load_lab_config
from .connector_client import ConnectorClient
from .memory import remember_after
from .persona import LIA
from .providers import build_llm, build_realtime, build_stt, build_tts, describe
from .turn_metrics import TurnBreakdown, TurnMetricsCollector

# Monorepo root .env (apps/agent/src/brainagent_agent -> ../../../../.env), then local.
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".env"))
load_dotenv()

logger = logging.getLogger("brainagent.agent")

OPENING_LINE = "Hola. ¿En qué te puedo ayudar?"

METRICS_TOPIC = "lab.metrics"
DEFAULT_AGENT_NAME = "brainagent-lab"


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


# One warm process in dev too (LiveKit's dev default is 0, which adds seconds to every
# connection while a process spawns and loads the VAD).
server = AgentServer(
    setup_fnc=prewarm,
    num_idle_processes=ServerEnvOption(dev_default=1, prod_default=8),
    # Heavy SDKs imported on first use blocked the first call for seconds (the anthropic
    # types alone took ~2 s). Import them while the idle process warms up instead.
    preload_modules=[
        "anthropic.types",
        "httpcore",
        "livekit.plugins.anthropic",
        "livekit.plugins.deepgram",
        "livekit.plugins.elevenlabs",
        "livekit.plugins.cartesia",
        "livekit.plugins.google",
        "livekit.plugins.openai",
    ],
)


def build_session(
    cfg: LabConfig,
    proc: JobProcess,
    runtime_agent: RuntimeAgent | None = None,
    tools: list[llm.Tool] | None = None,
) -> tuple[AgentSession, Agent]:
    instructions = runtime_agent.instructions if runtime_agent else LIA.instructions
    if cfg.client_greeting:
        instructions += (
            f"\n\nLa llamada ya ha empezado con tu saludo «{OPENING_LINE}». No vuelvas a "
            "saludar: espera a que la persona hable y respóndele directamente."
        )
    agent = Agent(instructions=instructions, tools=list[llm.Tool | llm.Toolset](tools or []))

    if cfg.mode == "realtime":
        realtime_cfg = cfg.realtime
        persona_voice = (
            catalog_voice("google", runtime_agent.persona_slug) if runtime_agent else None
        )
        if persona_voice and not cfg.realtime.voice_overridden:
            realtime_cfg = cfg.realtime.model_copy(update={"voice": persona_voice})
        model = build_realtime(realtime_cfg, instructions)
        return AgentSession(llm=model), agent

    tts_cfg = cfg.tts
    # The persona's voice applies unless the lab form chose one explicitly.
    if (
        runtime_agent
        and runtime_agent.voice_ref
        and runtime_agent.voice_provider == cfg.tts.provider
        and not cfg.voice_overridden
    ):
        tts_cfg = cfg.tts.model_copy(update={"voice_id": runtime_agent.voice_ref})

    session: AgentSession = AgentSession(
        vad=proc.userdata["vad"],
        stt=build_stt(cfg.stt),
        llm=build_agent_llm(runtime_agent, cfg.llm) if runtime_agent else build_llm(cfg.llm),
        tts=build_tts(tts_cfg),
        turn_handling=TurnHandlingOptions(
            # Local audio model: no audio leaves our infra for turn detection (the default
            # in dev mode would be LiveKit Inference, a cloud service).
            turn_detection=inference.TurnDetector(version="v1-mini"),
            # "vad" keeps barge-in local; the default "adaptive" mode streams audio to
            # LiveKit's cloud gateway.
            interruption={"enabled": True, "mode": "vad"},
            endpointing={"min_delay": cfg.min_endpointing_delay},
            preemptive_generation={
                "enabled": cfg.preemptive_generation,
                "preemptive_tts": cfg.preemptive_generation and cfg.preemptive_tts,
            },
        ),
        max_tool_steps=runtime_agent.max_tool_steps if runtime_agent else 3,
    )
    return session, agent


async def load_runtime_agent(
    cfg: LabConfig,
) -> tuple[RuntimeAgent, ToolBridge, ConnectorClient] | None:
    if not cfg.agent_id or not cfg.tenant_id:
        return None
    client = ConnectorClient()
    agent_cfg = await client.agent_config(cfg.tenant_id, cfg.agent_id, cfg.contact_id)
    runtime_agent = RuntimeAgent.from_config(cfg.tenant_id, agent_cfg)
    bridge = ToolBridge(
        client=client, agent=runtime_agent, conversation_id=cfg.conversation_id, channel="voice"
    )
    return runtime_agent, bridge, client


@server.rtc_session(agent_name=os.environ.get("LIVEKIT_AGENT_NAME") or DEFAULT_AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    try:
        cfg = load_lab_config(ctx.job.metadata)
    except InvalidLabConfig:
        logger.exception("invalid lab config, closing job")
        ctx.shutdown(reason="invalid lab config")
        return

    labels = describe(cfg)
    logger.info("starting lab session", extra={"labels": labels, "room": ctx.room.name})

    async def publish(payload: dict) -> None:
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps(payload), reliable=True, topic=METRICS_TOPIC
            )
        except Exception:
            logger.exception("failed to publish lab metrics")

    runtime: tuple[RuntimeAgent, ToolBridge, ConnectorClient] | None = None
    try:
        runtime = await load_runtime_agent(cfg)
        session, agent = build_session(
            cfg,
            ctx.proc,
            runtime[0] if runtime else None,
            build_function_tools(runtime[1]) if runtime else None,
        )
    except Exception as exc:
        # Usually a missing API key or an unknown provider: tell the lab UI instead of
        # leaving the user waiting for an agent that never speaks.
        logger.exception("could not build the voice session")
        await ctx.connect()
        await publish({"type": "error", "message": str(exc)})
        ctx.shutdown(reason="invalid provider configuration")
        return

    turn_index = 0
    background: set[asyncio.Task[None]] = set()

    def on_turn(turn: TurnBreakdown) -> None:
        nonlocal turn_index
        turn_index += 1
        payload = {
            "type": "turn",
            "turn": turn_index,
            "sentAt": time.time() * 1000,
            **turn.to_payload(),
            # After to_payload(): its per-turn labels must not drop the session labels.
            "labels": {**labels, **turn.labels},
        }
        task = asyncio.create_task(publish(payload))
        background.add(task)
        task.add_done_callback(background.discard)

    collector = TurnMetricsCollector(on_turn)

    @session.on("metrics_collected")
    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        collector.collect(ev.metrics)

    @session.on("agent_state_changed")
    def _on_agent_state(ev: AgentStateChangedEvent) -> None:
        if ev.new_state == "speaking":
            collector.agent_started_speaking(ev.created_at)

    @session.on("user_state_changed")
    def _on_user_state(ev: UserStateChangedEvent) -> None:
        # Realtime models detect turns server-side (no EOU metric): use the moment the
        # user stopped speaking as the start of the turn for first-audio timing.
        if ev.old_state == "speaking" and ev.new_state != "speaking":
            collector.user_stopped_speaking(ev.created_at)

    @session.on("error")
    def _on_error(ev: ErrorEvent) -> None:
        # STT/LLM/TTS errors carry `recoverable`; only surface the ones that end the turn.
        if getattr(ev.error, "recoverable", False):
            return
        label = getattr(ev.error, "label", type(ev.source).__name__)
        detail = getattr(ev.error, "error", ev.error)
        task = asyncio.create_task(publish({"type": "error", "message": f"{label}: {detail}"}))
        background.add(task)
        task.add_done_callback(background.discard)

    if runtime:
        bridge = runtime[1]
        client = runtime[2]

        @session.on("conversation_item_added")
        def _on_item(ev: ConversationItemAddedEvent) -> None:
            # Write confirmations need a new user turn (see agent_runtime.ToolBridge).
            if getattr(ev.item, "role", None) == "user":
                bridge.user_message_received()

        runtime_agent = runtime[0]

        async def _remember_and_close() -> None:
            # Learn from the call (memory per contact), then release the client.
            try:
                if runtime_agent.contact_id:
                    turns = [
                        {"role": item.role, "content": item.text_content or ""}
                        for item in session.history.items
                        if isinstance(item, llm.ChatMessage) and item.role in ("user", "assistant")
                    ]
                    await remember_after(
                        client,
                        build_llm(cfg.llm),
                        runtime_agent.tenant_id,
                        runtime_agent.contact_id,
                        cfg.conversation_id,
                        runtime_agent.memory,
                        turns,
                    )
            finally:
                await client.aclose()

        ctx.add_shutdown_callback(_remember_and_close)

    await session.start(agent=agent, room=ctx.room)

    # Every call opens with the same short line (product decision); the AI disclosure is
    # on screen in every channel that shows one, and the agent says it is an AI if asked.
    # With client_greeting the web plays it (greeting video with its own voice).
    if not cfg.client_greeting:
        if cfg.mode == "realtime":
            session.generate_reply(instructions=f"Saluda diciendo exactamente: {OPENING_LINE}")
        else:
            session.say(OPENING_LINE)

    async def enforce_max_duration() -> None:
        await asyncio.sleep(cfg.max_session_seconds)
        logger.info("lab session reached max duration", extra={"room": ctx.room.name})
        handle = session.say(
            "Hemos llegado al límite de tiempo de esta prueba. Hasta pronto.",
            allow_interruptions=False,
        )
        await handle
        ctx.shutdown(reason="max session duration")

    limiter = asyncio.create_task(enforce_max_duration())
    ctx.add_shutdown_callback(lambda: _cancel(limiter))


async def _cancel(task: asyncio.Task[None]) -> None:
    task.cancel()


if __name__ == "__main__":
    cli.run_app(server)
