import asyncio

from brainagent_agent.transcript import TranscriptRecorder


class FakeSink:
    def __init__(self, fail_first: bool = False) -> None:
        self.batches: list[list[dict[str, str]]] = []
        self.ended: list[str] = []
        self._fail = fail_first

    async def add_messages(self, tenant_id, conversation_id, items):
        await asyncio.sleep(0)
        if self._fail:
            self._fail = False
            raise RuntimeError("connector down")
        self.batches.append(items)

    async def end_conversation(self, tenant_id, conversation_id):
        self.ended.append(conversation_id)


async def test_lines_are_saved_in_order_and_the_conversation_ends() -> None:
    sink = FakeSink()
    rec = TranscriptRecorder(sink, "t1", "c1")
    rec.add("assistant", "Hola. ¿En qué te puedo ayudar?")
    rec.add("user", "  Dime las facturas de hoy ")
    rec.add("user", "   ")  # empty: ignored
    rec.add("system", "instrucciones")  # not part of the transcript
    await rec.close()
    lines = [item for batch in sink.batches for item in batch]
    assert lines == [
        {"role": "assistant", "content": "Hola. ¿En qué te puedo ayudar?"},
        {"role": "user", "content": "Dime las facturas de hoy"},
    ]
    assert sink.ended == ["c1"]


async def test_a_failed_save_does_not_stop_later_lines() -> None:
    sink = FakeSink(fail_first=True)
    rec = TranscriptRecorder(sink, "t1", "c1")
    rec.add("user", "primera")
    await asyncio.sleep(0.01)
    rec.add("assistant", "segunda")
    await rec.close()
    assert [i["content"] for b in sink.batches for i in b] == ["segunda"]
    assert sink.ended == ["c1"]
