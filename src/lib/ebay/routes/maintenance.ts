import { h, Router } from './router';
import type { Db } from '../db/db';
import { getBackupSettings, getBackupStatus, listBackups, runBackup, saveBackupSettings, DEFAULT_KEEP } from '../backup/backup';
import { buildAccountingZip, parseDay } from '../export/accounting';
import { listInvoices } from '../invoices/store';


/** Datensicherung und Buchhaltungs-Export. */
export function maintenanceRouter(db: Db, backupDir: string | null): Router {
  const r = new Router();

  r.get('/backup', h(async (_req, res) => {
    res.json({
      settings: getBackupSettings(backupDir),
      defaultKeep: DEFAULT_KEEP,
      status: getBackupStatus(backupDir),
      dir: backupDir,
      files: listBackups(backupDir).slice(0, 10),
    });
  }));

  r.put('/backup', h(async (req, res) => {
    res.json(saveBackupSettings(backupDir, (req.body ?? {}) as Record<string, unknown>));
  }));

  r.post('/backup/run', h(async (_req, res) => {
    const status = runBackup(backupDir);
    if (status.error && !status.file) throw new Error(status.error);
    res.json(status);
  }));

  r.get('/export/accounting', h(async (req, res) => {
    const from = parseDay(req.query.from, 'Von');
    const to = parseDay(req.query.to, 'Bis');
    if (from > to) throw new Error('„Von" liegt nach „Bis".');
    const { zip } = await buildAccountingZip(await listInvoices(db), from, to);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Buchhaltung_${from}_bis_${to}.zip"`);
    res.send(zip);
  }));

  return r;
}
