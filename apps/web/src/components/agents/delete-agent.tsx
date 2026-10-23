"use client";

import { Button, Input } from "@brainagent/ui";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { deleteAgent } from "@/app/(app)/agents/actions";

/**
 * Danger zone of "Personalizar". It lives inside the settings form, so it only uses
 * type="button" controls; deleting asks for the agent's name to avoid accidents.
 */
export function DeleteAgent({ agentId, agentName }: { agentId: string; agentName: string }) {
  const t = useTranslations("customize");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section
      aria-labelledby="delete-agent-title"
      className="rounded-[22px] border border-bad/30 bg-surface p-4"
      data-testid="delete-agent"
    >
      <h2 id="delete-agent-title" className="text-sm font-medium text-bad">
        {t("deleteTitle")}
      </h2>
      <p className="mt-1 text-xs text-ink-2">{t("deleteBody")}</p>
      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor="delete-agent-name" className="text-xs text-ink-2">
            {t("deleteConfirm", { name: agentName })}
          </label>
          <Input
            id="delete-agent-name"
            value={typed}
            autoComplete="off"
            onChange={(e) => {
              setTyped(e.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p role="alert" className="text-xs text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="w-full whitespace-nowrap"
              disabled={pending || typed.trim() !== agentName.trim()}
              onClick={() =>
                start(async () => {
                  // On success the action redirects to the agent list.
                  const res = await deleteAgent(agentId, typed);
                  if (res && !res.ok) setError(res.error);
                })
              }
            >
              <Trash2 className="size-4" />
              {pending ? t("deleting") : t("deleteForever")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3 text-bad"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-4" />
          {t("delete")}
        </Button>
      )}
    </section>
  );
}
