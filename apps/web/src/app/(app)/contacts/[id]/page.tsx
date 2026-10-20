import { contactMemories, contacts, conversations } from "@brainagent/db";
import { Badge, Card, CardHeader } from "@brainagent/ui";
import { count, desc, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ContactDanger, MemoryAdd, MemoryDelete } from "@/components/contacts/memory-controls";
import { Monogram, PageHeader } from "@/components/page-header";
import { requireTenant, tenantTx } from "@/lib/tenant";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("contacts");
  const format = await getFormatter();
  const data = await tenantTx(ctx, async (tx) => {
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, id)).limit(1);
    if (!contact) return null;
    const memories = await tx
      .select()
      .from(contactMemories)
      .where(eq(contactMemories.contactId, id))
      .orderBy(desc(contactMemories.createdAt));
    const [convs] = await tx
      .select({ n: count() })
      .from(conversations)
      .where(eq(conversations.contactId, id));
    return { contact, memories, conversations: convs?.n ?? 0 };
  });
  if (!data) notFound();
  const { contact, memories } = data;
  const canEdit = ctx.role !== "viewer";
  const canErase = ctx.role === "owner" || ctx.role === "admin";
  const name = contact.displayName || contact.email || contact.phone || t("unknown");

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Monogram name={name} />
            {name}
          </span>
        }
        subtitle={[contact.email, contact.phone, t("conversations", { count: data.conversations })]
          .filter(Boolean)
          .join(" · ")}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title={t("memoryTitle")} aside={<Badge>{memories.length}</Badge>} />
          <p className="border-b border-line px-5 py-3 text-sm text-ink-2">{t("memoryHint")}</p>
          {memories.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-3">{t("memoryEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line" data-testid="memory-list">
              {memories.map((m) => (
                <li key={m.id} className="flex items-start gap-3 px-5 py-3">
                  <p className="flex-1 text-sm">{m.content}</p>
                  <Badge
                    tone={
                      m.source === "explicit" ? "signal" : m.source === "manual" ? "ok" : "neutral"
                    }
                  >
                    {t(`source.${m.source}`)}
                  </Badge>
                  <span className="shrink-0 text-xs text-ink-3">
                    {format.dateTime(m.createdAt, { dateStyle: "short" })}
                  </span>
                  {canEdit ? <MemoryDelete contactId={id} memoryId={m.id} /> : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? <MemoryAdd contactId={id} /> : null}
        </Card>
        {canErase ? <ContactDanger contactId={id} hasMemory={memories.length > 0} /> : null}
      </div>
    </>
  );
}
