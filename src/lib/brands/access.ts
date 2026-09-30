import "server-only";
import { brandAllowed } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import { listBrands } from "./service";

// Marken-Freigabe: Mitarbeiter können auf einzelne Marken beschränkt sein (z. B. nur Zeitlux).

export async function visibleBrands(session: Session) {
  return (await listBrands(session.tenantId)).filter((b) => brandAllowed(session.brandIds, session.role, b.id));
}

export function assertBrand(session: Session, brandId: string) {
  if (!brandAllowed(session.brandIds, session.role, brandId)) throw new Error("Diese Marke ist für dich nicht freigegeben.");
}
