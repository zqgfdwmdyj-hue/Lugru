export const CLAIM_STATUS_LABEL: Record<string, [string, string]> = {
  detected: ["NEU", "tag-warn"],
  queued: ["VORGEMERKT", "tag-info"],
  submitted: ["EINGEREICHT", "tag-neutral"],
  reimbursed: ["ERSTATTET", "tag-ok"],
  partial: ["TEILWEISE", "tag-warn"],
  rejected: ["ABGELEHNT", "tag-critical"],
  escalated: ["ESKALIERT", "tag-critical"],
  dismissed: ["VERWORFEN", "tag-neutral"],
};
