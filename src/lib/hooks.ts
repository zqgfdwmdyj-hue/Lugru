import "server-only";

// Nachbearbeitung nach jedem Import (Ansprüche erkennen, Bestandswarnungen …).
// Module tragen sich hier ein, damit der Import nichts von ihnen wissen muss.

type Hook = (tenantId: string) => Promise<void>;
const hooks: { name: string; fn: Hook }[] = [];

export function onAfterImport(name: string, fn: Hook) {
  if (!hooks.some((h) => h.name === name)) hooks.push({ name, fn });
}

export async function runAfterImport(tenantId: string) {
  await import("./hooks-registry");
  for (const h of hooks) {
    try {
      await h.fn(tenantId);
    } catch (e) {
      console.error(`Nachbearbeitung „${h.name}“ fehlgeschlagen`, e);
    }
  }
}
