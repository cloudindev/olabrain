import { redirect } from "next/navigation";
import { getSession } from "@/lib/tenant";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.session.activeOrganizationId) redirect("/onboarding");
  redirect("/lab");
}
