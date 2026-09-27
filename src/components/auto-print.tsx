"use client";

import { useEffect } from "react";

export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (enabled) setTimeout(() => window.print(), 300);
  }, [enabled]);
  return null;
}
