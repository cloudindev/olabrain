"use client";

import { Button, Field, Select, Textarea } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { updateLead } from "@/app/(app)/leads/actions";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/lead-status";

/** Status and comments of a lead: the team's follow-up (builders and up can edit). */
export function LeadFollowUp({
  leadId,
  status: initialStatus,
  comments: initialComments,
  canEdit,
}: {
  leadId: string;
  status: LeadStatus;
  comments: string;
  canEdit: boolean;
}) {
  const t = useTranslations("leads");
  const [status, setStatus] = useState(initialStatus);
  const [comments, setComments] = useState(initialComments);
  const [saved, setSaved] = useState<"idle" | "ok" | "error">("idle");
  const [pending, start] = useTransition();
  const dirty = status !== initialStatus || comments !== initialComments;

  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateLead(leadId, { status, comments });
          setSaved(res.ok ? "ok" : "error");
        });
      }}
    >
      <Field label={t("statusLabel")} htmlFor="lead-status">
        <Select
          id="lead-status"
          value={status}
          disabled={!canEdit || pending}
          onChange={(e) => {
            setStatus(e.target.value as LeadStatus);
            setSaved("idle");
          }}
        >
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("comments")} htmlFor="lead-comments">
        <Textarea
          id="lead-comments"
          value={comments}
          placeholder={t("commentsPlaceholder")}
          maxLength={5000}
          disabled={!canEdit || pending}
          onChange={(e) => {
            setComments(e.target.value);
            setSaved("idle");
          }}
        />
      </Field>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || !dirty}>
            {t("save")}
          </Button>
          {saved === "ok" && !dirty ? (
            <span className="text-sm text-ok" role="status">
              {t("saved")}
            </span>
          ) : saved === "error" ? (
            <span className="text-sm text-bad" role="alert">
              {t("saveError")}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
