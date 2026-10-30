import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SharePassword } from "@/components/share/share-password";
import { EmbedChat } from "@/components/widget/embed-chat";
import { hasShareAccess, resolveShare, shareCookieName } from "@/lib/share";

export const metadata: Metadata = { title: "Asistente", robots: { index: false, follow: false } };

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
