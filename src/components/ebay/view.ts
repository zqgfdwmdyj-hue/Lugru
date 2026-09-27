export type View =
  | { page: 'search' }
  | { page: 'history' }
  | { page: 'articles' }
  | { page: 'article'; key: string }
  | { page: 'settings'; tab?: string }
  | { page: 'invoices' }
  | { page: 'preview'; id: number };

/** Startansicht aus der Adresse (?ansicht=…), damit die Menüpunkte im Seller-System direkt hinführen. */
export function initialView(ansicht?: string, id?: string, tab?: string): View {
  if (ansicht === 'vorschau' && id && Number.isInteger(Number(id))) return { page: 'preview', id: Number(id) };
  if (ansicht === 'artikel') return { page: 'articles' };
  if (ansicht === 'verlauf') return { page: 'history' };
  if (ansicht === 'rechnungen') return { page: 'invoices' };
  if (ansicht === 'einstellungen') return { page: 'settings', tab };
  return { page: 'search' };
}
