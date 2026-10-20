import { contactMemories, contacts, conversations } from "@brainagent/db";
import { Badge, Card } from "@brainagent/ui";
import { countDistinct, desc, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Monogram, PageHeader } from "@/components/page-header";
import { requireTenant, tenantTx } from "@/lib/tenant";

export const metadata = { title: "Contactos" };

export default async function ContactsPage() {
  const ctx = await requireTenant("viewer");
  const t = await getTranslations("contacts");
  const format = await getFormatter();
  const rows = await tenantTx(ctx, (tx) =>
    tx
      .select({
        id: contacts.id,
        name: contacts.displayName,
        email: contacts.email,
        phone: contacts.phone,
        lastSeenAt: contacts.lastSeenAt,
        memories: countDistinct(contactMemories.id),
        conversations: countDistinct(conversations.id),
      })
      .from(contacts)
      .leftJoin(contactMemories, eq(contactMemories.contactId, contacts.id))
      .leftJoin(conversations, eq(conversations.contactId, contacts.id))
      .groupBy(contacts.id)
      .orderBy(desc(contacts.lastSeenAt)),
  );

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-ink-2">{t("empty")}</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line" data-testid="contact-list">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/contacts/${c.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-surface-2"
                >
                  <Monogram name={c.name || c.email || "?"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {c.name || c.email || c.phone || t("unknown")}
                    </p>
                    <p className="truncate text-sm text-ink-2">
                      {[c.email, c.phone].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Badge tone={c.memories ? "signal" : "neutral"}>
                    {t("memories", { count: c.memories })}
                  </Badge>
                  <Badge>{t("conversations", { count: c.conversations })}</Badge>
                  <span className="text-xs text-ink-3 max-sm:hidden">
                    {format.relativeTime(c.lastSeenAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
