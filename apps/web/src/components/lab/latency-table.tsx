"use client";

import { LATENCY_TARGETS_MS, summarizeLatencies, type LatencyKey } from "@brainagent/core";
import { Badge, Card, cn } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import type { MergedTurn } from "./latency-tracker";

const COLUMNS: {
  key: LatencyKey;
  label: "conn" | "eot" | "firstToken" | "firstAudio";
  where: "browser" | "worker";
}[] = [
  { key: "connMs", label: "conn", where: "browser" },
  { key: "eotMs", label: "eot", where: "worker" },
  { key: "firstTokenMs", label: "firstToken", where: "worker" },
  { key: "firstAudioMs", label: "firstAudio", where: "worker" },
];

function tone(key: LatencyKey, value: number | null): "ok" | "bad" | null {
  const target = LATENCY_TARGETS_MS[key];
  if (target === undefined || value === null) return null;
  return value <= target ? "ok" : "bad";
}

function Ms({ value, k }: { value: number | null; k: LatencyKey }) {
  if (value === null) return <span className="text-ink-3">—</span>;
  const tn = tone(k, value);
  return (
    <span
      className={cn("font-mono tabular-nums", tn === "ok" && "text-ok", tn === "bad" && "text-bad")}
    >
      {value.toLocaleString("es-ES")}
    </span>
  );
}

export function LatencySummary({ turns }: { turns: MergedTurn[] }) {
  const t = useTranslations("lab");
  const summary = summarizeLatencies(turns);
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="latency-summary">
      {COLUMNS.map(({ key, label, where }) => {
        const s = summary[key];
        const target = LATENCY_TARGETS_MS[key];
        return (
          <Card key={key} className="p-4">
            <p className="text-xs font-medium text-ink-2" title={t(`help.${label}`)}>
              {t(label)}
            </p>
            <p className="mt-2 flex items-baseline gap-1.5 font-mono text-2xl tabular-nums tracking-tight">
              <Ms value={s.p50} k={key} />
              {s.p50 !== null ? <span className="text-sm text-ink-3">ms</span> : null}
              <span className="ml-auto text-xs text-ink-3">p50</span>
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {s.p95 !== null ? (
                <>
                  {t("p95")} <Ms value={s.p95} k={key} /> ms ·{" "}
                </>
              ) : null}
              {t("samples", { count: s.n })}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge>{t("measuredIn", { where: t(where) })}</Badge>
              {target ? (
                <Badge tone="signal">{`${t("target")} < ${target.toLocaleString("es-ES")} ms`}</Badge>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function LatencyTable({ turns }: { turns: MergedTurn[] }) {
  const t = useTranslations("lab");
  if (turns.length === 0) {
    return <p className="px-5 py-4 text-sm text-ink-3">{t("latenciesEmpty")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm" data-testid="latency-table">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-3">
            <th className="px-5 py-2.5 font-medium">{t("turn")}</th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className="px-3 py-2.5 text-right font-medium"
                title={t(`help.${c.label}`)}
              >
                {t(c.label)}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right font-medium">{t("ttsTtfb")}</th>
            <th className="px-3 py-2.5 text-right font-medium" title={t("help.browserFirstAudio")}>
              {t("browserFirstAudio")}
            </th>
            <th className="px-5 py-2.5 font-medium">{t("providers")}</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn) => (
            <tr key={turn.turn} className="border-b border-line last:border-0">
              <td className="px-5 py-2.5 font-mono tabular-nums text-ink-2">{turn.turn}</td>
              {COLUMNS.map((c) => (
                <td key={c.key} className="px-3 py-2.5 text-right">
                  <Ms value={turn[c.key]} k={c.key} />
                </td>
              ))}
              <td className="px-3 py-2.5 text-right">
                <Ms value={turn.server.tts_ttfb_ms} k="eotMs" />
              </td>
              <td className="px-3 py-2.5 text-right">
                <Ms value={turn.browserFirstAudioMs} k="eotMs" />
              </td>
              <td
                className="max-w-56 truncate px-5 py-2.5 text-xs text-ink-3"
                title={Object.values(turn.server.labels).join(" · ")}
              >
                {Object.values(turn.server.labels).join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
