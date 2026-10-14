"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { rotatePhoto } from "@/app/(app)/actions";

/** ↺ / ↻ unter einem Produktfoto – dreht das gespeicherte Foto selbst (gilt überall: Liste, Collage, Social Media). */
export function RotateButtons({ productId, compact = false, onDone }: { productId: string; compact?: boolean; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const turn = (deg: number) =>
    start(async () => {
      await rotatePhoto(productId, deg);
      router.refresh();
      onDone?.();
    });
  const cls = compact ? "btn btn-small rotate-btn" : "btn btn-small";
  return (
    <span style={{ display: "inline-flex", gap: 4 }} aria-busy={pending}>
      <button className={cls} type="button" onClick={() => turn(270)} disabled={pending} title="Foto nach links drehen" aria-label="Foto nach links drehen">↺</button>
      <button className={cls} type="button" onClick={() => turn(90)} disabled={pending} title="Foto nach rechts drehen" aria-label="Foto nach rechts drehen">↻</button>
      {!compact && pending && <span className="small muted">dreht …</span>}
    </span>
  );
}
