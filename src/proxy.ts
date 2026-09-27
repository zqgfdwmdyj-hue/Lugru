import { NextResponse, type NextRequest } from "next/server";

// Schnelle Vorprüfung: ohne Sitzungs-Cookie direkt zum Login.
// Die eigentliche Prüfung passiert serverseitig in requireSession().
export function proxy(request: NextRequest) {
  if (!request.cookies.has("session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/oauth|api/cron|api/ebay|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
