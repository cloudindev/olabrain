"use client";

import { Badge, Button, Card, CardHeader, Select, Switch, Textarea } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { testSavedTool, updateTool } from "@/app/(app)/connections/actions";
import { StudioEditor, type StudioInitial } from "./studio-editor";

type ToolItem = {
  id: string;
  name: string;
  description: string;
  mode: "read" | "write";
  confirmation: "required" | "auto";
  enabled: boolean;
  inputSchema: Record<string, unknown>;
  config: Record<string, unknown>;
};

/** Example arguments from a JSON schema, so "Probar" starts with something sensible. */
function exampleArgs(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; format?: string }>;
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(props)) {
    out[k] =
      p.format === "date"
        ? new Date().toISOString().slice(0, 10)
        : p.type === "number" || p.type === "integer"
          ? 0
          : p.type === "boolean"
            ? false
            : "";
  }
  return JSON.stringify(out, null, 2);
}

function ToolRow({
  tool,
  canEdit,
  connectionId,
  kind,
  studio,
}: {
  tool: ToolItem;
  canEdit: boolean;
  connectionId: string;
  kind: string;
  studio: boolean;
}) {
  const t = useTranslations("connections");
  const [open, setOpen] = useState<"test" | "edit" | null>(null);
  const [args, setArgs] = useState(() => exampleArgs(tool.inputSchema));
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(allowWrite: boolean) {
    start(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(args || "{}");
      } catch {
        setResult("JSON no válido");
        return;
      }
      const res = await testSavedTool(tool.id, parsed, allowWrite);
      setResult(
        res.ok ? `${res.data.durationMs} ms\n${JSON.stringify(res.data.data, null, 2)}` : res.error,
      );
    });
  }

  return (
    <li className="px-5 py-3" data-testid={`tool-${tool.name}`}>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Switch
            label={`${t("enabled")} ${tool.name}`}
            defaultChecked={tool.enabled}
            onChange={(e) => void updateTool(tool.id, { enabled: e.target.checked })}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm">{tool.name}</p>
          <p className="line-clamp-2 text-sm text-ink-2">{tool.description}</p>
        </div>
        <Badge tone={tool.mode === "write" ? "warn" : "neutral"}>{t(tool.mode)}</Badge>
        {tool.mode === "write" && canEdit ? (
          <Select
            aria-label={t("confirmation")}
            className="h-8 w-auto text-xs"
            defaultValue={tool.confirmation}
            onChange={(e) =>
              void updateTool(tool.id, { confirmation: e.target.value as "required" | "auto" })
            }
          >
            <option value="required">{t("confirmationRequired")}</option>
            <option value="auto">{t("confirmationAuto")}</option>
          </Select>
        ) : null}
        {canEdit ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(open === "test" ? null : "test")}
          >
            {t("test")}
          </Button>
        ) : null}
        {canEdit && studio ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(open === "edit" ? null : "edit")}
          >
            {t("editTool")}
          </Button>
        ) : null}
      </div>
      {open === "test" ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label={t("args")}
              rows={5}
              className="font-mono text-xs"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
            <div>
              <Button
                size="sm"
                variant={tool.mode === "write" ? "danger" : "secondary"}
                disabled={pending}
                onClick={() => run(tool.mode === "write")}
              >
                {tool.mode === "write" ? t("runWrite") : t("run")}
              </Button>
            </div>
          </div>
          <pre
            className="max-h-72 overflow-auto rounded-[var(--radius-control)] bg-surface-2 p-3 font-mono text-xs"
            data-testid="tool-result"
          >
            {result ?? t("result")}
          </pre>
        </div>
      ) : null}
      {open === "edit" ? (
        <div className="mt-3 rounded-[var(--radius-control)] border border-line">
          <StudioEditor
            connectionId={connectionId}
            kind={kind as "sql" | "http"}
            toolId={tool.id}
            initial={
              { name: tool.name, description: tool.description, ...tool.config } as StudioInitial
            }
          />
        </div>
      ) : null}
    </li>
  );
}

export function ToolsTable(props: {
  tools: ToolItem[];
  canEdit: boolean;
  connectionId: string;
  kind: string;
  studio: boolean;
}) {
  const t = useTranslations("connections");
  return (
    <Card>
      <CardHeader title={`${t("tools")} (${props.tools.length})`} />
      {props.tools.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-3">{t("noTools")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {props.tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              canEdit={props.canEdit}
              connectionId={props.connectionId}
              kind={props.kind}
              studio={props.studio}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
