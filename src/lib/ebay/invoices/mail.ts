import nodemailer from 'nodemailer';
import type { SmtpSettings } from './types';

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; content: Uint8Array };
}

export type MailSender = (mail: MailInput) => Promise<void>;

export function smtpMissing(smtp: SmtpSettings | undefined, fallbackFrom?: string): string[] {
  const missing: string[] = [];
  if (!smtp?.host?.trim()) missing.push('SMTP-Server');
  if (!smtp?.user?.trim()) missing.push('Benutzername');
  if (!smtp?.pass) missing.push('Passwort');
  if (!smtp?.from?.trim() && !fallbackFrom?.trim()) missing.push('Absenderadresse');
  return missing;
}

/** Versand über das eigene Postfach des Verkäufers (SMTP). */
export function makeSmtpSender(smtp: SmtpSettings, fallbackFrom?: string): MailSender {
  const missing = smtpMissing(smtp, fallbackFrom);
  if (missing.length > 0) throw new Error(`E-Mail-Versand ist nicht eingerichtet — es fehlt: ${missing.join(', ')}.`);
  const port = smtp.port ?? (smtp.secure === false ? 587 : 465);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: smtp.secure ?? port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 15_000,
  });
  const from = smtp.from?.trim() || fallbackFrom!.trim();
  return async (mail) => {
    try {
      await transport.sendMail({
        from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        attachments: mail.attachment
          ? [{ filename: mail.attachment.filename, content: Buffer.from(mail.attachment.content), contentType: 'application/pdf' }]
          : undefined,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (/auth|535|534/i.test(m)) throw new Error(`Anmeldung am Mailserver fehlgeschlagen — Benutzername/Passwort prüfen (${m}).`);
      if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) throw new Error(`Mailserver nicht erreichbar — Server und Port prüfen (${m}).`);
      throw new Error(`E-Mail konnte nicht gesendet werden: ${m}`);
    }
  };
}
