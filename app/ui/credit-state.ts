// One policy for overview badges, wallet ordering, and available actions.
type Credit = {
  tracking_type: string;
  remaining_usd: number | null;
  used_usd: number;
  requires_membership_year: boolean;
  attention_reason?: "expiring" | "date_needed" | null;
  periods: unknown[];
};

export function creditActions(benefit: Credit) {
  const spend = benefit.tracking_type === "spend";
  return {
    log: spend && !benefit.requires_membership_year && benefit.periods.length === 0 && (benefit.remaining_usd ?? 0) > 0,
    edit: spend && !benefit.requires_membership_year && benefit.periods.length === 0 && benefit.used_usd > 0,
    setDate: spend && benefit.requires_membership_year,
  };
}

export function cardCreditState(card: { benefits: Credit[] }) {
  const credits = card.benefits.filter(benefit => benefit.tracking_type === "spend");
  const available = credits.filter(benefit => (benefit.remaining_usd ?? 0) > 0).length;
  const dateNeeded = credits.filter(benefit => benefit.requires_membership_year).length;
  const expiring = credits.filter(benefit => (benefit.remaining_usd ?? 0) > 0 && benefit.attention_reason === "expiring").length;
  const label = dateNeeded ? "Anniversary date needed" : expiring
    ? `${expiring} credit${expiring === 1 ? "" : "s"} expiring soon`
    : available ? `${available} credit${available === 1 ? "" : "s"} available` : "No credits available";
  return { available, dateNeeded, expiring, label, warning: dateNeeded > 0 || expiring > 0, visible: available > 0 || dateNeeded > 0 };
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
