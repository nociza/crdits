// Catalog labels are descriptions, not proof of eligibility. Structured constraints
// can narrow a rule; unstructured restrictions require explicit user confirmation.
export function rewardEligibility(rule, query, cardSlug, { base = false } = {}) {
  if (!rule || rule.rate == null || (rule.valid_from && query.asOf < rule.valid_from) || (rule.valid_to && query.asOf > rule.valid_to)) return { matches: false, eligible: false };
  const key = `${cardSlug}:${rule.id}`;
  const context = query.context || {};
  const constraints = rule.constraints;
  const category = String(query.category || "").toLowerCase();
  const merchant = String(query.merchant || "").toLowerCase();
  let matches = base || (rule.category !== "other" && rule.category === category) || (rule.match_terms || []).some(term => merchant && merchant === String(term).toLowerCase());
  if (constraints?.categories) matches = constraints.categories.includes(category);
  if (constraints?.merchants) matches = matches && constraints.merchants.some(term => merchant === String(term).toLowerCase());
  const channelKnown = !constraints?.channels || constraints.channels.includes(context.channel);
  const restrictedLabel = /\b(through|direct|portal|select|eligible|partner|first|U\.?S\.?|Lyft|Peloton|Amazon|Hilton|Hyatt|Marriott|Whole Foods|rotating)\b/i.test(rule.label || "");
  const requiresConfirmation = Boolean(rule.conditional || rule.activation_required || (!constraints && restrictedLabel && !base));
  const confirmed = Array.isArray(context.confirmed_rules) && context.confirmed_rules.includes(key);
  const capped = rule.cap_usd != null || rule.cap_formula != null;
  const suppliedCap = context.remaining_caps?.[`${cardSlug}:${rule.cap_group || rule.id}`];
  const capKnown = typeof suppliedCap === "number" && Number.isFinite(suppliedCap) && suppliedCap >= 0;
  const eligible = matches && channelKnown && (!requiresConfirmation || confirmed) && (!capped || capKnown);
  return { matches, eligible, key, limit: capped && capKnown ? Math.min(suppliedCap, rule.cap_usd ?? Infinity) : Infinity,
    reason: capped && !capKnown ? "Confirm eligibility and remaining spending cap" : "Confirm the merchant, booking channel, and eligibility in the rule terms" };
}

export function unconditionalBase(rule, asOf) {
  if (!rule || (rule.valid_from && asOf < rule.valid_from) || (rule.valid_to && asOf > rule.valid_to)) return null;
  if (!rule.conditional && !rule.activation_required && rule.cap_usd == null && !rule.cap_formula) return rule;
  return rule.unconditional_rate == null ? null : { ...rule, rate: rule.unconditional_rate, label: `${rule.unconditional_rate}${rule.rate_type === "cashback_percent" ? "%" : "X"} base earn; conditional bonuses not assumed` };
}
