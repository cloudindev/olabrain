import { ConnectorRequestError, connectorFetch } from "@/lib/connector";
import { AuthError, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

/** OAuth redirect target for MCP servers. The connector checks `state` against the vault. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const oauthError = url.searchParams.get("error");
  const connectionId = state.split(".")[0] ?? "";
  const back = (query: string) =>
    Response.redirect(new URL(`/connections/${connectionId}?${query}`, url), 303);

  try {
    const ctx = await requireTenant("admin");
    if (oauthError || !code || !state)
      return back(`oauth=error&message=${encodeURIComponent(oauthError ?? "missing code")}`);
    await connectorFetch(ctx.tenantId, "/v1/connections/oauth/complete", { body: { state, code } });
    return back("oauth=ok");
  } catch (e) {
    if (e instanceof AuthError) return Response.redirect(new URL("/login", url), 303);
    const message = e instanceof ConnectorRequestError ? e.message : "error";
    return back(`oauth=error&message=${encodeURIComponent(message)}`);
  }
}
