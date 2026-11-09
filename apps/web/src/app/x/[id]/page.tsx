import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ExtranetLogin } from "@/components/extranet/extranet-login";
import { EmbedChat } from "@/components/widget/embed-chat";
import { extranetAccount, extranetCookieName, resolveExtranet } from "@/lib/extranet";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const robots = { index: false, follow: false };
  const link = z.uuid().safeParse(id).success ? await resolveExtranet(id) : null;
  return { title: { absolute: link ? link.agentName : "Área de clientes" }, robots };
}

/**
 * Extranet (ADR-030): the organization's customers sign in with a one-time code and talk
 * to the agent about their own data and orders, by chat or voice.
 */
export default async function ExtranetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const { id } = await params;
  const { email } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const link = await resolveExtranet(id);
  if (!link) notFound();
  const agent = { name: link.agentName, role: link.agentRole, avatar: link.avatarImage };
  const account = await extranetAccount(link, (await cookies()).get(extranetCookieName(id))?.value);
  if (!account)
    return (
      <ExtranetLogin
        linkId={link.id}
        agent={agent}
        org={{ name: link.orgName, logo: link.orgLogo }}
        initialEmail={typeof email === "string" ? email.slice(0, 254) : ""}
      />
    );
  return (
    <EmbedChat
      channelId={link.id}
      agent={agent}
      voice={link.config.voice}
      halo={{ mode: "multicolor", color: "#a6f55a" }}
      apiBase={`/api/extranet/${link.id}`}
      standalone
      avatar={{ video: link.avatarVideo, image: link.avatarImage }}
      session={{
        id: account.id,
        label: account.personName
          ? `${account.personName} · ${account.customerName}`
          : account.customerName,
        logoutUrl: `/api/extranet/${link.id}/logout`,
      }}
    />
  );
}
