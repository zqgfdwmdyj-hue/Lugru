import type { NextConfig } from "next";
import { publicOrigins } from "./src/lib/public-url";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "bwip-js"],
  // Die Typprüfung braucht ohne Zwischenspeicher rund 1,4 GB – auf dem 2-GB-Server bricht der Docker-Build
  // sonst mit „heap out of memory“ ab. Das Dockerfile setzt deshalb NEXT_SKIP_TYPECHECK=1; geprüft wird vor
  // jedem Hochladen in der Entwicklung (tsc + Tests). Lokal prüft „npm run build“ weiterhin.
  typescript: { ignoreBuildErrors: process.env.NEXT_SKIP_TYPECHECK === "1" },
  // Freigabe-Seite für Claude nie in fremde Seiten einbetten (Schutz vor untergeschobenen Klicks).
  async headers() {
    return [{ source: "/oauth/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] }];
  },
  experimental: {
    // Hinter einem Proxy mit öffentlicher Adresse (PUBLIC_URL, z. B. Tailscale Funnel für Claude) kommen Login und
    // Freigabe von dieser Adresse – dort als erlaubter Ursprung, damit die Formulare nicht abgewiesen werden.
    serverActions: { bodySizeLimit: "20mb", allowedOrigins: publicOrigins() },
  },
};

export default nextConfig;
