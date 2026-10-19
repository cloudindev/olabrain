"use client";

import { Badge, Button, Card, CardHeader, Checkbox } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { setAgentTools } from "@/app/(app)/agents/actions";

type ToolOption = {
  id: string;
  name: string;
  description: string;
  mode: "read" | "write";
  confirmation: "required" | "auto";
  enabled: boolean;
  connectionId: string;
  connectionName: string;
  connectionKind: string;
};

export function AgentToolsPicker({
  agentId,
  tools,
  assigned,
}: {
  agentId: string;
  tools: ToolOption[];
  assigned: string[];
}) {
  const t = useTranslations("agents");
  const tc = useTranslations("connections");
  const [selected, setSelected] = useState(new Set(assigned));
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; kind: string; tools: ToolOption[] }>();
    for (const tool of tools) {
      const g = map.get(tool.connectionId) ?? {
        name: tool.connectionName,
        kind: tool.connectionKind,
        tools: [],
      };
      g.tools.push(tool);
      map.set(tool.connectionId, g);
    }
    return [...map.entries()];
  }, [tools]);

  if (tools.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-ink-2">{t("noTools")}</p>
        <Link href="/connections/new" className="mt-4 inline-block">
          <Button variant="secondary">{t("addConnection")}</Button>
        </Link>
      </Card>
    );
  }

  function toggle(id: string, on: boolean) {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-ink-2">{t("toolsIntro")}</p>
      {groups.map(([connectionId, group]) => (
        <Card key={connectionId}>
          <CardHeader
            title={
              <Link href={`/connections/${connectionId}`} className="hover:underline">
                {group.name}
              </Link>
            }
            aside={<Badge>{tc(`kinds.${group.kind}`)}</Badge>}
          />
          <ul className="divide-y divide-line">
            {group.tools.map((tool) => (
              <li key={tool.id} className="flex items-start gap-3 px-5 py-3">
                <Checkbox
                  aria-label={tool.name}
                  checked={selected.has(tool.id)}
                  disabled={!tool.enabled}
                  onChange={(e) => toggle(tool.id, e.target.checked)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm">{tool.name}</p>
                  <p className="line-clamp-2 text-sm text-ink-2">{tool.description}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Badge tone={tool.mode === "write" ? "warn" : "neutral"}>{tc(tool.mode)}</Badge>
                  {!tool.enabled ? <Badge tone="bad">off</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <div className="flex items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setAgentTools(agentId, [...selected]);
              setSaved(res.ok);
            })
          }
        >
          {t("save")}
        </Button>
        {saved ? <span className="text-sm text-ok">{t("saved")}</span> : null}
      </div>
    </div>
  );
}
