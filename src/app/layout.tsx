import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seller-System",
  description: "Einkauf, Bestand, Ansprüche und To-dos an einem Ort.",
  applicationName: "Seller-System",
  // iPhone/iPad: „Zum Home-Bildschirm“ startet ohne Safari-Leiste.
  appleWebApp: { capable: true, title: "Seller", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0e6b5f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
