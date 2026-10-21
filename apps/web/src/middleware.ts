import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Cheap cookie presence check; real session + membership validation happens server-side.
const PROTECTED = ["/lab", "/onboarding", "/agents", "/connections", "/contacts"];

// Served on any domain (marketing site included): the home and what it needs.
const PUBLIC_ANY_HOST = ["/", "/api/public/", "/alba/", "/favicon"];

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

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The marketing domains (olabrain.com, www.) only show the home. Sign-in, the panel and
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
