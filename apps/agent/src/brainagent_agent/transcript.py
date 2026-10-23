"""Saves the voice transcript as the call goes (CLAUDE.md: voice transcripts are always
kept). Each line is queued when it is transcribed and posted in order to apps/connector,
so a call that drops mid-way still keeps everything said until then."""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol

logger = logging.getLogger("brainagent.transcript")

MAX_BATCH = 20
MAX_CHARS = 20_000


class TranscriptSink(Protocol):
    async def add_messages(
        self, tenant_id: str, conversation_id: str, items: list[dict[str, str]]
    ) -> None: ...

    async def end_conversation(self, tenant_id: str, conversation_id: str) -> None: ...


class TranscriptRecorder:
    def __init__(self, sink: TranscriptSink, tenant_id: str, conversation_id: str) -> None:
        self._sink = sink
        self._tenant_id = tenant_id
        self._conversation_id = conversation_id
        self._queue: asyncio.Queue[dict[str, str] | None] = asyncio.Queue()
        self._task = asyncio.create_task(self._run())

    def add(self, role: str, text: str | None) -> None:
        """Queues a finished line (user or assistant); empty text is ignored."""
        if role not in ("user", "assistant"):
            return
        content = (text or "").strip()
        if content:
            self._queue.put_nowait({"role": role, "content": content[:MAX_CHARS]})

    async def _run(self) -> None:
        done = False
        while not done:
            first = await self._queue.get()
            if first is None:
                break
            batch = [first]
            # Lines that arrived meanwhile go in the same request (order preserved).
            while len(batch) < MAX_BATCH and not self._queue.empty():
                item = self._queue.get_nowait()
                if item is None:
                    done = True
                    break
                batch.append(item)
            try:
                await self._sink.add_messages(self._tenant_id, self._conversation_id, batch)
            except Exception:
                # Never break the call over a transcript; log and keep going.
                logger.exception("could not save %d transcript line(s)", len(batch))

    async def close(self) -> None:
        """Flushes pending lines and marks the conversation as ended."""
        self._queue.put_nowait(None)
        try:
            await asyncio.wait_for(self._task, timeout=15)
        except Exception:
            logger.exception("transcript flush did not finish")
        try:
            await self._sink.end_conversation(self._tenant_id, self._conversation_id)
        except Exception:
            logger.exception("could not mark the conversation as ended")
