"use client";

import { Button, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveStudioTool, testStudioTool } from "@/app/(app)/connections/actions";

type Param = {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "date";
  description: string;
  required: boolean;
};

export type StudioInitial = {
  name?: string;
  description?: string;
  query?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path?: string;
  bodyTemplate?: string;
  params?: Param[];
  maxRows?: number;
  timeoutMs?: number;
};

const PARAM_TYPES: Param["type"][] = ["string", "number", "integer", "boolean", "date"];

export function StudioEditor({
  connectionId,
  kind,
  toolId,
  initial = {},
}: {
  connectionId: string;
  kind: "sql" | "http";
  toolId?: string;
  initial?: StudioInitial;
}) {
  const t = useTranslations("studio");
  const tc = useTranslations("connections");
  const router = useRouter();
  const [name, setName] = useState(initial.name ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [query, setQuery] = useState(initial.query ?? "SELECT * FROM tabla WHERE fecha = :fecha");
  const [method, setMethod] = useState(initial.method ?? "GET");
  const [path, setPath] = useState(initial.path ?? "/");
  const [bodyTemplate, setBodyTemplate] = useState(initial.bodyTemplate ?? "");
  const [params, setParams] = useState<Param[]>(initial.params ?? []);
  const [maxRows, setMaxRows] = useState(String(initial.maxRows ?? 100));
  const [timeoutMs, setTimeoutMs] = useState(
    String(initial.timeoutMs ?? (kind === "sql" ? 5000 : 10000)),
  );
  const [testArgs, setTestArgs] = useState("{}");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const definition = () =>
    kind === "sql"
      ? {
          kind,
          definition: {
            name,
            description,
            query,
            params,
            maxRows: Number(maxRows),
            timeoutMs: Number(timeoutMs),
          },
        }
      : {
          kind,
          definition: {
            name,
            description,
            method,
            path,
            bodyTemplate: bodyTemplate || undefined,
            params,
            timeoutMs: Number(timeoutMs),
          },
        };

  const setParam = (i: number, patch: Partial<Param>) =>
    setParams((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const isWrite = kind === "http" && method !== "GET";

  return (
    <div>
      <CardHeader
        title={toolId ? `${t("title")} · ${initial.name}` : `${t("title")} · ${tc("newTool")}`}
      />
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_minmax(280px,380px)]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("name")} htmlFor={`s-name-${toolId ?? "new"}`}>
              <Input
                id={`s-name-${toolId ?? "new"}`}
                className="font-mono"
                value={name}
                placeholder="partes_hoy"
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              />
            </Field>
            {kind === "http" ? (
              <Field label={t("method")} htmlFor={`s-method-${toolId ?? "new"}`}>
                <Select
                  id={`s-method-${toolId ?? "new"}`}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as typeof method)}
                >
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          <Field
            label={t("description")}
            htmlFor={`s-desc-${toolId ?? "new"}`}
            hint={t("descriptionHint")}
          >
            <Textarea
              id={`s-desc-${toolId ?? "new"}`}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {kind === "sql" ? (
            <Field label={t("query")} htmlFor={`s-query-${toolId ?? "new"}`} hint={t("queryHint")}>
              <Textarea
                id={`s-query-${toolId ?? "new"}`}
                rows={6}
                className="font-mono text-xs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field label={t("path")} htmlFor={`s-path-${toolId ?? "new"}`} hint={t("pathHint")}>
                <Input
                  id={`s-path-${toolId ?? "new"}`}
                  className="font-mono text-xs"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
              </Field>
              {method !== "GET" ? (
                <Field label={t("body")} htmlFor={`s-body-${toolId ?? "new"}`}>
                  <Textarea
                    id={`s-body-${toolId ?? "new"}`}
                    rows={4}
                    className="font-mono text-xs"
                    value={bodyTemplate}
                    onChange={(e) => setBodyTemplate(e.target.value)}
                  />
                </Field>
              ) : null}
            </>
          )}

          <div>
            <p className="mb-2 text-sm font-medium text-ink-2">{t("params")}</p>
            <div className="flex flex-col gap-2">
              {params.map((p, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_120px_2fr_auto_auto] items-center gap-2"
                >
                  <Input
                    aria-label={t("paramName")}
                    placeholder={t("paramName")}
                    className="font-mono text-xs"
                    value={p.name}
                    onChange={(e) => setParam(i, { name: e.target.value })}
                  />
                  <Select
                    aria-label={t("paramType")}
                    value={p.type}
                    onChange={(e) => setParam(i, { type: e.target.value as Param["type"] })}
                  >
                    {PARAM_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </Select>
                  <Input
                    aria-label={t("paramDescription")}
                    placeholder={t("paramDescription")}
                    value={p.description}
                    onChange={(e) => setParam(i, { description: e.target.value })}
                  />
                  <Checkbox
                    label={t("required")}
                    checked={p.required}
                    onChange={(e) => setParam(i, { required: e.target.checked })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="Quitar"
                    onClick={() => setParams((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setParams((prev) => [
                      ...prev,
                      { name: "", type: "string", description: "", required: true },
                    ])
                  }
                >
                  {t("addParam")}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {kind === "sql" ? (
              <Field label={t("maxRows")} htmlFor={`s-rows-${toolId ?? "new"}`}>
                <Input
                  id={`s-rows-${toolId ?? "new"}`}
                  inputMode="numeric"
                  value={maxRows}
                  onChange={(e) => setMaxRows(e.target.value)}
                />
              </Field>
            ) : null}
            <Field label={t("timeout")} htmlFor={`s-timeout-${toolId ?? "new"}`}>
              <Input
                id={`s-timeout-${toolId ?? "new"}`}
                inputMode="numeric"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={pending || !name || !description}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await saveStudioTool(connectionId, definition(), toolId);
                  if (!res.ok) setError(res.error);
                  else router.refresh();
                })
              }
            >
              {t("save")}
            </Button>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Field label={t("testArgs")} htmlFor={`s-args-${toolId ?? "new"}`}>
            <Textarea
              id={`s-args-${toolId ?? "new"}`}
              rows={4}
              className="font-mono text-xs"
              value={testArgs}
              onChange={(e) => setTestArgs(e.target.value)}
            />
          </Field>
          <div>
            <Button
              variant={isWrite ? "danger" : "secondary"}
              disabled={pending || !name || !description}
              onClick={() =>
                start(async () => {
                  let args: unknown;
                  try {
                    args = JSON.parse(testArgs || "{}");
                  } catch {
                    setOutput("JSON no válido");
                    return;
                  }
                  const res = await testStudioTool(connectionId, definition(), args, isWrite);
                  setOutput(
                    res.ok
                      ? `${res.data.durationMs} ms${res.data.truncated ? " · recortado" : ""}\n${JSON.stringify(res.data.data, null, 2)}`
                      : res.error,
                  );
                })
              }
            >
              {isWrite ? tc("runWrite") : t("try")}
            </Button>
          </div>
          <pre
            className="max-h-80 min-h-32 overflow-auto rounded-[var(--radius-control)] bg-surface-2 p-3 font-mono text-xs"
            data-testid="studio-output"
          >
            {output ?? tc("result")}
          </pre>
        </div>
      </div>
    </div>
  );
}
