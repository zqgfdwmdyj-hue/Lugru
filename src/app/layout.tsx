import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seller-System",
  description: "Einkauf, Bestand, Ansprüche und To-dos an einem Ort.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
