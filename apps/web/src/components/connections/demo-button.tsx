"use client";

import { Button } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { addDemoConnection } from "@/app/(app)/connections/actions";

export function DemoButton() {
  const t = useTranslations("connections");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end">
      <Button
        variant="secondary"
        title={t("demoHint")}
        disabled={pending}
        onClick={() =>
          start(async () => {
            // On success the action redirects to the new connection.
            const res = await addDemoConnection();
            if (!res.ok) setError(res.error);
          })
        }
      >
        {t("demo")}
      </Button>
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : null}
    </div>
  );
}
