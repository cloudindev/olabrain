"use client";

import { Loader2 } from "lucide-react";
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

/** Inside a <Link>: shows a spinner instead of `children` while that navigation loads. */
export function LinkPending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <>{children}</>;
}
