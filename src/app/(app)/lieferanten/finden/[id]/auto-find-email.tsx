"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { autoFindEmailAction } from "../actions";

/** Beim Öffnen einer Firma ohne E-Mail: Suche einmal starten, die Seite lädt bis zum Ergebnis neu. */
export function AutoFindEmail({ id }: { id: string }) {
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void autoFindEmailAction(id).then(() => router.refresh());
  }, [id, router]);
  return null;
}
