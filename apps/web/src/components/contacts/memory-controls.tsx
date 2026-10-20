"use client";

import { Button, Card, Input } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { addMemory, clearMemory, deleteMemory, eraseContact } from "@/app/(app)/contacts/actions";

export function MemoryDelete({ contactId, memoryId }: { contactId: string; memoryId: string }) {
  const t = useTranslations("contacts");
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={t("forget")}
      disabled={pending}
      onClick={() => start(() => void deleteMemory(contactId, memoryId))}
    >
      ×
    </Button>
  );
}

export function MemoryAdd({ contactId }: { contactId: string }) {
  const t = useTranslations("contacts");
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex gap-2 border-t border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        start(async () => {
          await addMemory(contactId, value);
          setValue("");
        });
      }}
    >
      <Input
        aria-label={t("addPlaceholder")}
        placeholder={t("addPlaceholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={500}
      />
      <Button type="submit" variant="secondary" disabled={pending || !value.trim()}>
        {t("add")}
      </Button>
    </form>
  );
}

export function ContactDanger({ contactId, hasMemory }: { contactId: string; hasMemory: boolean }) {
  const t = useTranslations("contacts");
  const [pending, start] = useTransition();
  return (
    <Card className="flex h-fit flex-col gap-3 p-5">
      <p className="font-display text-sm font-semibold">{t("privacy")}</p>
      <p className="text-sm text-ink-2">{t("privacyHint")}</p>
      <Button
        variant="secondary"
        disabled={pending || !hasMemory}
        onClick={() => {
          if (confirm(t("clearConfirm"))) start(() => void clearMemory(contactId));
        }}
      >
        {t("clear")}
      </Button>
      <Button
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (confirm(t("eraseConfirm"))) start(() => void eraseContact(contactId));
        }}
      >
        {t("erase")}
      </Button>
    </Card>
  );
}
