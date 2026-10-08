import type { MetadataRoute } from "next";

// Macht das Spenden-Tool installierbar („Zum Home-Bildschirm“ auf dem iPhone, „App installieren“ auf Android).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spenden-Tool",
    short_name: "Spenden",
    description: "Spendenprodukte, Collagen, Aushänge und Social Media für die Lebensmittelverteilung",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f3ef",
    theme_color: "#1f7a4d",
    lang: "de",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
