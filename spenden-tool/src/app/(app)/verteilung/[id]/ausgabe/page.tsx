import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { loadEventView } from "@/lib/event-view";
import { eventFlyerSections } from "@/lib/service";
import { exportWarnings } from "@/lib/export-check";
import { eventDateLabel, messengerText } from "@/lib/layout";
import { CopyButton } from "@/components/copy-button";

type Card = { href: string; title: string; hint: string; icon: string; blank?: boolean };

export default async function AusgabePage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  const view = await loadEventView(id);
  if (!view) notFound();
  const { event, rows } = view;
  const base = `/verteilung/${id}`;
  const collage = rows.filter((r) => r.item.inCollage);
  const flyer = rows.filter((r) => r.item.inFlyer);
  const warnings = exportWarnings(rows.filter((r) => r.item.inCollage || r.item.inFlyer));
  const text = messengerText({ ...event, dateLabel: eventDateLabel(event.eventDate) }, eventFlyerSections(rows));

  const groups: { title: string; note: string; cards: Card[] }[] = [
    {
      title: "Messenger & Gruppen",
      note: `${collage.length} Produkte auf Bildern · ${flyer.length} im Text`,
      cards: [
        { href: `${base}/collage?vorlage=whatsapp`, title: "WhatsApp-Collage", hint: "Bilder 4:5 mit Preisen, mehrere Produkte je Bild", icon: "🖼️" },
        { href: "#messenger", title: "Messenger-Text", hint: "Liste zum Kopieren für WhatsApp, Signal, Telegram", icon: "💬" },
      ],
    },
    {
      title: "Drucken",
      note: `${flyer.length} Produkte mit Häkchen „Aushang“`,
      cards: [
        { href: `/aushang/${id}`, title: "A4-Aushang", hint: "Liste mit Spendenempfehlungen und MHD – drucken oder als PDF", icon: "📄", blank: true },
        { href: `${base}/collage?vorlage=a4`, title: "A4-Collage", hint: "Fotos mit Preisen zum Aufhängen, als PDF", icon: "🖨️" },
      ],
    },
    {
      title: "Social Media",
      note: "Highlights lassen sich dort auswählen und sortieren",
      cards: [
        { href: `${base}/social?format=story`, title: "Instagram-Story", hint: "Ankündigung 9:16", icon: "📱" },
        { href: `${base}/social?format=feed`, title: "Feed-Beitrag", hint: "Titelbild 4:5", icon: "🟩" },
        { href: `${base}/social?format=karussell`, title: "Karussell", hint: "ein Produkt pro Bild zum Wischen", icon: "🎠" },
        { href: `${base}/social?format=story-produkte`, title: "Story-Serie", hint: "Highlights einzeln", icon: "⭐" },
        { href: `${base}/social?format=video`, title: "Video", hint: "Reel / TikTok, 9:16", icon: "🎬" },
        { href: `${base}/social?format=preisliste`, title: "Preisliste als Bild", hint: "der Aushang zum Posten", icon: "🧾" },
        { href: `${base}/social?format=texte`, title: "Texte", hint: "Beschreibung für Instagram & TikTok", icon: "✍️" },
      ],
    },
    {
      title: "Ideen",
      note: "mit KI",
      cards: [{ href: `${base}/ideen`, title: "Ideen für die Verteilung", hint: "Themenpakete, Rezepte, Werbetext, Plakat", icon: "✨" }],
    },
  ];

  return (
    <div className="stack" style={{ gap: 18 }}>
      {warnings.length > 0 ? (
        <div className="notice notice-warn">
          <strong>Vor dem Export:</strong> {warnings.join(" · ")}. Ausgegeben wird überall die eingetragene Spendenempfehlung. <Link href={`${base}/pruefen`}>Jetzt prüfen</Link>
        </div>
      ) : (
        <div className="notice notice-ok">✓ Alles bereit: Alle Preise sind bestätigt und erscheinen überall gleich.</div>
      )}
      {groups.map((g) => (
        <section key={g.title} className="stack" style={{ gap: 8 }}>
          <div className="between"><h2>{g.title}</h2><span className="small muted">{g.note}</span></div>
          <div className="output-grid">
            {g.cards.map((c) => (
              <Link key={c.title} href={c.href} className="card output-card" target={c.blank ? "_blank" : undefined}>
                <span className="output-icon" aria-hidden>{c.icon}</span>
                <span><strong>{c.title}</strong><span className="small muted">{c.hint}</span></span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <section id="messenger" className="card card-pad stack">
        <div className="between">
          <h2>Text für WhatsApp / Signal / Telegram</h2>
          <CopyButton text={text} label="Text kopieren" />
        </div>
        <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--sans)", maxHeight: 420, overflow: "auto", background: "var(--surface-2)", padding: 12, borderRadius: 8 }}>{text}</pre>
      </section>
    </div>
  );
}
