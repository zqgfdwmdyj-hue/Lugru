"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Alte Links wie /privat/paar#paarzeit auf die neuen Unteransichten umleiten. */
const MAP: Record<string, string> = {
  "#paarzeit": "/privat/paar/paarzeit",
  "#ideen": "/privat/paar/paarzeit#ideen",
  "#danke": "/privat/paar/wertschaetzung",
  "#stimmung": "/privat/paar/wertschaetzung#stimmung",
  "#gespraech": "/privat/paar/gespraech",
};

export function HashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const to = MAP[window.location.hash];
    if (to) router.replace(to);
  }, [router]);
  return null;
}
