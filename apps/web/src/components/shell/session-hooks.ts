"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/** Switches the active organization and reloads the panel on /agents. */
export function useSwitchOrg() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function switchOrg(organizationId: string) {
    setBusy(true);
    await authClient.organization.setActive({ organizationId });
    router.push("/agents");
    router.refresh();
    setBusy(false);
  }
  return { busy, switchOrg };
}

/** Signs out and goes to the login page. */
export function useSignOut() {
  const router = useRouter();
  return async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };
}
