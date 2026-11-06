import type { NachrichtEintrag } from "@/lib/inbox/persoenlich";

export const STATUS_TEXT: Record<NachrichtEintrag["status"], [string, string]> = {
  offen: ["Antwort offen", "tag-warn"],
  unsicher: ["persönlich?", "tag-info"],
  beantwortet: ["beantwortet", "tag-ok"],
  beantwortet_extern: ["beantwortet (extern)", "tag-ok"],
  erledigt: ["erledigt", "tag-neutral"],
  ausgehend: ["ausgehend", "tag-neutral"],
};
