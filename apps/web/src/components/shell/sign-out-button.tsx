"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const t = useTranslations("common");
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-[var(--radius-control)] px-2 py-1.5 text-sm whitespace-nowrap sm:px-2.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      {t("signOut")}
    </button>
  );
}
