import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SharePassword } from "@/components/share/share-password";
import { EmbedChat } from "@/components/widget/embed-chat";
import { env } from "@/lib/env";
import { hasShareAccess, resolveShare, shareCookieName } from "@/lib/share";

/**
 * Link preview (WhatsApp, Slack, email…): the agent's name, role and photo. Nothing
 * private: the same things the password page shows.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const robots = { index: false, follow: false };
  const link = z.uuid().safeParse(id).success ? await resolveShare(id) : null;
  if (!link) return { title: "Asistente", robots };
  const base = env().APP_URL.replace(/\/$/, "");
  const title = link.agentRole ? `${link.agentName} · ${link.agentRole}` : link.agentName;
  const description = `Habla con ${link.agentName}, asistente con IA de OlaBrain.`;
  const image = link.avatarImage
    ? /^https?:/.test(link.avatarImage)
      ? link.avatarImage
      : `${base}${link.avatarImage}`
    : null;
  return {
    title: { absolute: title },
    description,
    robots,
    openGraph: {
      type: "website",
      siteName: "OlaBrain",
      url: `${base}/c/${link.id}`,
      title,
      description,
      ...(image ? { images: [{ url: image, alt: link.agentName }] } : {}),
    },
    twitter: { card: "summary", title, description, ...(image ? { images: [image] } : {}) },
  };
}

/** Shared link (ADR-022): password first, then the agent's chat and voice on a full page. */
export default async function SharedAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const link = await resolveShare(id);
  if (!link) notFound();
  const agent = { name: link.agentName, role: link.agentRole, avatar: link.avatarImage };
  if (!hasShareAccess((await cookies()).get(shareCookieName(link.id))?.value, link)) {
    return <SharePassword linkId={link.id} agent={agent} />;
  }
  return (
    <EmbedChat
      channelId={link.id}
      agent={agent}
      voice={link.config.voice}
      halo={{ mode: "multicolor", color: "#a6f55a" }}
      apiBase={`/api/share/${link.id}`}
      standalone
    />
  );
}
