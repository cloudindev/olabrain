import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmbedChat } from "@/components/widget/embed-chat";
import { resolveChannel } from "@/lib/widget";

export const metadata: Metadata = { title: "Chat", robots: { index: false, follow: false } };

/** The widget panel (loaded in an iframe by public/widget.js on the customer's site). */
export default async function EmbedPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  if (!z.uuid().safeParse(channelId).success) notFound();
  const channel = await resolveChannel(channelId);
  if (!channel) notFound();
  return (
    <>
      {/* The widget's own theme wins over the device's and the saved panel one (no flash). */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.dataset.theme=${JSON.stringify(channel.config.theme)}`,
        }}
      />
      <EmbedChat
        channelId={channel.id}
        agent={{ name: channel.agentName, role: channel.agentRole, avatar: channel.avatarImage }}
        voice={channel.config.voice}
        halo={channel.config.halo}
      />
    </>
  );
}
