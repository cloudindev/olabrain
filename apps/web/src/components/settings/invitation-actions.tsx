"use client";

import { Button } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/** Accept (joins and activates the organization) or decline an invitation. */
export function InvitationActions({ invitationId }: { invitationId: string }) {
  const t = useTranslations("settings.invitation");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "accept" | "reject") {
    setBusy(kind);
    setError(null);
    const { error: apiError } =
      kind === "accept"
        ? await authClient.organization.acceptInvitation({ invitationId })
        : await authClient.organization.rejectInvitation({ invitationId });
    if (apiError) {
      setBusy(null);
      setError(tc("error"));
      return;
    }
    router.push("/agents");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" disabled={busy !== null} onClick={() => void run("accept")}>
          {t("accept")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void run("reject")}
        >
          {t("reject")}
        </Button>
      </div>
    </div>
  );
}
