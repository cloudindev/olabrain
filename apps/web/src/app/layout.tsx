import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import "./globals.css";

const heading = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});
const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
const numeric = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-numeric",
  display: "swap",
});

// viewport-fit=cover: iOS reports the area under Safari's floating toolbar and the home
// indicator as env(safe-area-inset-*), so full-screen views can keep controls above it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: { default: "BrainAgent", template: "%s · BrainAgent" },
  description: "Empleados digitales con voz y chat para tu empresa.",
  robots: { index: false, follow: false },
};

// Applies the saved theme before first paint (no flash). "system" = no attribute.
const THEME_SCRIPT = `try{var t=localStorage.getItem("ba-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${heading.variable} ${body.variable} ${numeric.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* Extensions (e.g. ColorZilla) add attributes to <body> before hydration. */}
      <body className="min-h-dvh" suppressHydrationWarning>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
