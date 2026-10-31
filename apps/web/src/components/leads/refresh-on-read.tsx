"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The lead was just marked read while rendering its page, but layouts don't re-render on
 * client navigation: refresh so the navbar badge and the cached list catch up.
 */
export function RefreshOnRead() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
