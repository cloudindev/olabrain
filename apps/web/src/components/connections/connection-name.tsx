"use client";

import { Button, Input, cn } from "@brainagent/ui";
import { Check, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { renameConnection } from "@/app/(app)/connections/actions";

/** A connection's name as a heading, editable in place by owners and admins. */
export function ConnectionName({
  connectionId,
  name,
  canEdit,
  className,
}: {
  connectionId: string;
  name: string;
  canEdit: boolean;
  className?: string;
}) {
  const t = useTranslations("connections");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className={cn("truncate", className)} data-testid="connection-name">
          {name}
        </span>
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setValue(name);
              setError(null);
              setEditing(true);
            }}
            className="shrink-0 rounded-full p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-ink"
            aria-label={t("rename")}
            title={t("rename")}
            data-testid="connection-rename"
          >
            <Pencil className="size-4" />
          </button>
        ) : null}
      </span>
    );
  }

  function save() {
    const next = value.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    start(async () => {
      const res = await renameConnection(connectionId, next);
      if (!res.ok) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <span className="flex items-center gap-2">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={80}
          aria-label={t("renameLabel")}
          className="h-9 max-w-xs"
          data-testid="connection-name-input"
        />
        <Button type="submit" size="sm" disabled={pending} aria-label={t("renameSave")}>
          <Check className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setEditing(false)}
          aria-label={t("renameCancel")}
        >
          <X className="size-4" />
        </Button>
      </span>
      {error ? <span className="block font-sans text-xs font-normal text-bad">{error}</span> : null}
    </form>
  );
}
