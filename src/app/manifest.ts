import type { MetadataRoute } from "next";

// App auf dem Home-Bildschirm (Android/iPhone/Desktop): eigenes Icon, Vollbild ohne Browserleiste.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "LuGru Seller-System",
    short_name: "Seller",
    description: "Aufträge, Einkauf, Marken, Amazon und eBay an einem Ort.",
    lang: "de",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f3ef",
    theme_color: "#0e6b5f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Start & Aufgaben", url: "/" },
      { name: "Posteingang", url: "/posteingang" },
      { name: "Aufträge", url: "/auftraege" },
      { name: "Ideen & Saison", url: "/marken" },
    ],
  };
}
