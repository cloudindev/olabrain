import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Cheap cookie presence check; real session + membership validation happens server-side.
const PROTECTED = ["/lab", "/onboarding", "/agents", "/connections", "/contacts"];

// Served on any domain (marketing site included): the home, the legal pages and what
// they need.
const PUBLIC_ANY_HOST = [
  "/",
  "/api/public/",
  "/alba/",
  "/favicon",
  "/aviso-legal",
  "/privacidad",
  "/cookies",
];

function isPublicAnyHost(pathname: string): boolean {
  return PUBLIC_ANY_HOST.some((p) => (p === "/" ? pathname === "/" : pathname.startsWith(p)));
}

/** Host of APP_URL (e.g. app.olabrain.com); null when not configured or invalid. */
function appHost(): string | null {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).host : null;
  } catch {
    return null;
  }
}

/**
 * The widget panel may only be framed by the sites its admin allowed (any site while the
 * list is empty). The list comes from the widget's public config.
 */
async function embedResponse(request: NextRequest, channelId: string) {
  let origins: string[] = [];
  try {
    const res = await fetch(new URL(`/api/widget/${channelId}/config`, request.url));
    if (res.ok) origins = ((await res.json()) as { origins?: string[] }).origins ?? [];
  } catch {
    // config unreachable: the page itself will 404 if the widget doesn't exist
  }
  const ancestors = origins.length ? `'self' ${origins.join(" ")}` : "*";
  const response = NextResponse.next();
  response.headers.set("content-security-policy", `frame-ancestors ${ancestors}`);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const embed = /^\/embed\/([0-9a-f-]{36})$/.exec(pathname);
  if (embed) return embedResponse(request, embed[1]!);

  // The marketing domains (olabrain.com, www.) only show the home and the legal pages. Sign-in, the panel and
  // the APIs live on APP_URL, so the session cookie and Better Auth's origin check see
  // a single domain.
  const app = appHost();
  const host = request.headers.get("host");
  if (app && host && host !== app && !isPublicAnyHost(pathname)) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, process.env.APP_URL), 308);
  }

  if (
    PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) &&
    !getSessionCookie(request)
  ) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next.js internals and static files with an extension.
  matcher: ["/((?!_next/|.*\\.[a-z0-9]+$).*)"],
};
