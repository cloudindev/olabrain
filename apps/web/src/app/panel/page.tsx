import { redirect } from "next/navigation";
import { getSession } from "@/lib/tenant";

/** Entry point after sign-in: onboarding until there is an organization, then the panel. */
export default async function PanelEntry() {
  const session = await getSession();
  if (!session) redirect("/login?next=/panel");
  if (!session.session.activeOrganizationId) redirect("/onboarding");
  redirect("/agents");
}
