// One policy for overview badges, wallet ordering, and available actions.
type Credit = {
  tracking_type: string;
  counts_toward_value?: boolean;
  remaining_usd: number | null;
  used_usd: number;
  requires_membership_year: boolean;
  attention_reason?: "expiring" | "date_needed" | "award_date_needed" | null;
  periods: unknown[];
  awards?: { status: string }[];
  annual_award?: boolean;
};

export function availableCreditValue(card: { benefits: Credit[] }) {
  return card.benefits.filter(benefit => benefit.counts_toward_value && benefit.tracking_type === "spend")
    .reduce((total, benefit) => total + (benefit.remaining_usd || 0), 0);
}

export function creditActions(benefit: Credit) {
  const spend = benefit.tracking_type === "spend";
  return {
    log: spend && !benefit.requires_membership_year && benefit.periods.length === 0 && (benefit.remaining_usd ?? 0) > 0,
    edit: spend && !benefit.requires_membership_year && benefit.periods.length === 0 && benefit.used_usd > 0,
    setDate: spend && benefit.requires_membership_year,
  };
}

export function periodEvidenceState(period: { used_usd: number; evidence?: { assessment: "used" | "likely_used" | "not_used"; note: string } | null }) {
  // Explicit monetary bookkeeping takes precedence over an earlier report.
  // Reports alone never imply an amount or contribute to realized card value.
  if (period.used_usd > 0 || !period.evidence) return null;
  if (period.evidence.assessment === "not_used") return { label: "Not used", detail: "Reported", unconfirmed: false };
  return { label: period.evidence.assessment === "likely_used" ? "Likely used" : "Reported used", detail: "Not counted", unconfirmed: true };
}

export function cardCreditState(card: { benefits: Credit[] }) {
  const credits = card.benefits.filter(benefit => benefit.tracking_type === "spend");
  const available = credits.filter(benefit => (benefit.remaining_usd ?? 0) > 0).length;
  const dateNeeded = credits.filter(benefit => benefit.requires_membership_year).length;
  const expiring = credits.filter(benefit => (benefit.remaining_usd ?? 0) > 0 && benefit.attention_reason === "expiring").length;
  const certificates = card.benefits.filter(benefit => benefit.tracking_type === "award");
  const awardAvailable = certificates.flatMap(benefit => benefit.awards || []).filter(award => award.status === "available").length;
  const awardsToTrack = certificates.filter(benefit => benefit.annual_award !== false && !benefit.awards?.length).length;
  const awardExpiring = certificates.filter(benefit => benefit.attention_reason === "expiring").length;
  const expiryNeeded = certificates.some(benefit => benefit.attention_reason === "award_date_needed");
  const label = expiryNeeded ? "Free-night expiry date needed" : awardExpiring ? "Free night expiring soon" : dateNeeded ? "Anniversary date needed" : expiring
    ? `${expiring} credit${expiring === 1 ? "" : "s"} expiring soon`
    : available ? `${available} credit${available === 1 ? "" : "s"} available` : awardAvailable ? `${awardAvailable} free night${awardAvailable === 1 ? "" : "s"} available` : awardsToTrack ? "Free night to track" : "No credits available";
  return { available, dateNeeded, expiring, awardAvailable, awardsToTrack, label, warning: expiryNeeded || dateNeeded > 0 || expiring > 0 || awardExpiring > 0, visible: expiryNeeded || available > 0 || dateNeeded > 0 || awardAvailable > 0 || awardsToTrack > 0 };
}

export function creditViewUrl(tab: "overview" | "wallet" | "catalog", year: number, cardId?: number) {
  const query = new URLSearchParams({ tab, year: String(year) });
  if (tab === "wallet" && cardId) query.set("card", String(cardId));
  return `?${query}`;
}

export function catalogStatus(status: string) {
  if (status.includes("UNVERIFIED")) return "Legacy terms unverified";
  if (status.startsWith("ASSUMED")) return "Assumed product — confirm card";
  if (status === "CONFIRMED_FROM_SCREENSHOT_LABEL") return "Product identified";
  if (status === "CONFIRMED") return "Product confirmed";
  return "Product not confirmed";
}
