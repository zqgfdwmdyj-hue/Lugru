import { NextResponse, type NextRequest } from "next/server";

// Schnelle Vorprüfung: ohne Sitzungs-Cookie direkt zum Login.
// Die eigentliche Prüfung passiert serverseitig in requireLogin().
export function proxy(request: NextRequest) {
  if (!request.cookies.has("spenden_session")) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|icons/).*)"],
};
