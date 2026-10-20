"use client";

import { Button } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteConnection, syncConnection } from "@/app/(app)/connections/actions";

export function ConnectionActions({ connectionId, kind }: { connectionId: string; kind: string }) {
  const t = useTranslations("connections");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {kind === "mcp" || kind === "native" ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await syncConnection(connectionId);
                if (!res.ok) setError(res.error);
                else if (res.data.authorizationUrl)
                  window.location.href = res.data.authorizationUrl;
                else router.refresh();
              })
            }
          >
            {t("sync")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!confirm(t("deleteConfirm"))) return;
            start(async () => {
              await deleteConnection(connectionId);
              router.push("/connections");
            });
          }}
        >
          {t("delete")}
        </Button>
      </div>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
