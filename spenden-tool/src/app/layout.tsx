import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spenden-Tool",
  description: "Spendenprodukte, Collagen und Aushänge für die Lebensmittelverteilung.",
  applicationName: "Spenden-Tool",
  // Auf dem iPhone: vom Home-Bildschirm aus im Vollbild wie eine App
  appleWebApp: { capable: true, title: "Spenden", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // ältere iOS-Versionen werten nur diesen Namen aus
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f7a4d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
