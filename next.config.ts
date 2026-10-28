import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "bwip-js"],
  // Die Typprüfung braucht ohne Zwischenspeicher rund 1,4 GB – auf dem 2-GB-Server bricht der Docker-Build
  // sonst mit „heap out of memory“ ab. Das Dockerfile setzt deshalb NEXT_SKIP_TYPECHECK=1; geprüft wird vor
  // jedem Hochladen in der Entwicklung (tsc + Tests). Lokal prüft „npm run build“ weiterhin.
  typescript: { ignoreBuildErrors: process.env.NEXT_SKIP_TYPECHECK === "1" },
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
