"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { autoDraftAction } from "../actions";

/** Beim Öffnen einer Firma ohne Entwurf: die KI schreibt ihn sofort (einmal), danach lädt die Seite neu. */
export function AutoDraft({ id }: { id: string }) {
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void autoDraftAction(id).then(() => router.refresh());
  }, [id, router]);
  return null;
}
