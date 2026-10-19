import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("auth");
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <section className="flex flex-col justify-between bg-ink px-8 py-10 text-paper max-lg:hidden">
        <Logo inverted />
        <div className="max-w-md">
          <Waveform />
          <p className="mt-8 font-display text-4xl leading-tight font-semibold tracking-tight">{t("signInSubtitle")}</p>
        </div>
        <p className="text-sm text-paper/60">Hecho en la UE · Datos en la UE cuando el proveedor lo permite</p>
      </section>
      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

/** Decorative static waveform: the product is a voice. */
function Waveform() {
  const bars = [6, 14, 22, 30, 18, 38, 26, 44, 20, 34, 12, 28, 40, 16, 24, 8];
  return (
    <svg viewBox="0 0 160 48" className="h-12 w-40" aria-hidden="true">
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 10}
          y={(48 - h) / 2}
          width="5"
          height={h}
          rx="2.5"
          className={i === 7 ? "fill-signal" : "fill-paper/70"}
        />
      ))}
    </svg>
  );
}
