import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Cheap cookie presence check; real session + membership validation happens server-side.
const PROTECTED = ["/lab", "/onboarding", "/agents", "/connections"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  matcher: ["/lab/:path*", "/onboarding/:path*", "/agents/:path*", "/connections/:path*"],
};
