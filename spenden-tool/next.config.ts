import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Eigenständige App im Unterordner – nicht das Seller-Tool darüber als Wurzel nehmen.
const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  serverExternalPackages: ["pg"],
  experimental: {
    // Mehrere Handyfotos auf einmal hochladen
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
