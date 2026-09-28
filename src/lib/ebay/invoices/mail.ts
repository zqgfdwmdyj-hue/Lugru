// Versand der Rechnungen: läuft über die Postfächer des Hauptsystems (siehe src/lib/mail/accounts.ts).
// Hier nur die Schnittstelle, damit die Rechnungslogik ohne Server testbar bleibt.

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; content: Uint8Array };
}

export type MailSender = (mail: MailInput) => Promise<void>;
