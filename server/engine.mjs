import {
  listBenefitStatuses,
  listOffers,
  listPreferences,
  listUsage,
  listWalletCards,
} from "./db.mjs";

const DAY_MS = 86_400_000;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RESET_CADENCE_LABELS = {
  monthly: (window) => MONTH_LABELS[Number(window.start.slice(5, 7)) - 1],
  quarterly: (window) => window.key.slice(-2),
  semiannual: (window) => window.key.slice(-2),
};

export function isResetCadence(cadence) {
  return Object.hasOwn(RESET_CADENCE_LABELS, cadence);
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function utcDate(value) {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function endOfMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0));
}

function addDays(date, count) {
  return new Date(date.getTime() + count * DAY_MS);
}

function clampDay(year, month, day) {
  return new Date(Date.UTC(year, month, Math.min(day, endOfMonth(year, month).getUTCDate())));
}

function overlaps(start, end, rangeStart, rangeEnd) {
  return start <= rangeEnd && end >= rangeStart;
}

function effectiveDuring(benefit, start, end) {
  const validFrom = benefit.valid_from ? utcDate(benefit.valid_from) : null;
  const validTo = benefit.valid_to ? utcDate(benefit.valid_to) : null;
  return (!validFrom || end >= validFrom) && (!validTo || start <= validTo);
}

function membershipAnchor(walletCard) {
  return walletCard.membership_year_start || walletCard.renewal_date || walletCard.opened_on || null;
}

export function enumerateCycles(benefit, walletCard, rangeStartInput, rangeEndInput) {
  const rangeStart = utcDate(rangeStartInput);
  const rangeEnd = utcDate(rangeEndInput);
  const windows = [];
  const push = (start, end, key) => {
    if (!overlaps(start, end, rangeStart, rangeEnd)) return;
    if (!effectiveDuring(benefit, start, end)) return;
    if (walletCard.opened_on && end < utcDate(walletCard.opened_on)) return;
    windows.push({ start: iso(start), end: iso(end), key });
  };

  const firstYear = rangeStart.getUTCFullYear() - 1;
  const lastYear = rangeEnd.getUTCFullYear() + 1;
  for (let year = firstYear; year <= lastYear; year += 1) {
    if (benefit.cadence === "monthly") {
      for (let month = 0; month < 12; month += 1) push(new Date(Date.UTC(year, month, 1)), endOfMonth(year, month), `${year}-${String(month + 1).padStart(2, "0")}`);
    } else if (benefit.cadence === "quarterly") {
      for (let month = 0; month < 12; month += 3) push(new Date(Date.UTC(year, month, 1)), endOfMonth(year, month + 2), `${year}-Q${month / 3 + 1}`);
    } else if (benefit.cadence === "semiannual") {
      push(new Date(Date.UTC(year, 0, 1)), endOfMonth(year, 5), `${year}-H1`);
      push(new Date(Date.UTC(year, 6, 1)), endOfMonth(year, 11), `${year}-H2`);
    } else if (benefit.cadence === "annual") {
      push(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 11, 31)), `${year}`);
    } else if (benefit.cadence === "anniversary") {
      const anchor = membershipAnchor(walletCard);
      if (!anchor) continue;
      const anchorDate = utcDate(anchor);
      const start = clampDay(year, anchorDate.getUTCMonth(), anchorDate.getUTCDate());
      const next = clampDay(year + 1, anchorDate.getUTCMonth(), anchorDate.getUTCDate());
      push(start, addDays(next, -1), `${year}-anniversary`);
    }
  }

  if (benefit.cadence === "one_time") {
    const start = utcDate(benefit.valid_from || rangeStart);
    const end = utcDate(benefit.valid_to || "9999-12-31");
    push(start, end, `${benefit.id}-one-time`);
  }

  if (benefit.cadence === "every_n_years") {
    const interval = Number(benefit.interval_years || 4);
    const anchor = utcDate(benefit.valid_from || walletCard.opened_on || rangeStart);
    for (let year = anchor.getUTCFullYear(); year <= lastYear; year += interval) {
      const start = clampDay(year, anchor.getUTCMonth(), anchor.getUTCDate());
      const end = addDays(clampDay(year + interval, anchor.getUTCMonth(), anchor.getUTCDate()), -1);
      push(start, end, `${year}-${interval}y`);
    }
  }

  return windows.sort((a, b) => a.start.localeCompare(b.start));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function trackingType(benefit) {
  if (benefit.tracking_type) return benefit.tracking_type;
  if (benefit.kind === "membership") return benefit.enrollment_required ? "enrollment" : "automatic";
  if (benefit.amount_usd == null) return "reference";
  return "spend";
}

function cycleAmount(benefit, card, preference) {
  if (preference.face_value_override != null) return Number(preference.face_value_override);
  if (benefit.amount_usd != null) return Number(benefit.amount_usd);
  if (benefit.points_amount != null && card.reward_currency?.point_value_cents != null) {
    return Number(benefit.points_amount) * Number(card.reward_currency.point_value_cents) / 100;
  }
  return null;
}

function catalogValue(benefit, card, preference) {
  if (preference.face_value_override != null) return Number(preference.face_value_override);
  if (benefit.valuation?.method === "excluded") return null;
  if (benefit.valuation?.value_usd != null) return Number(benefit.valuation.value_usd);
  if (benefit.points_amount != null && card.reward_currency?.point_value_cents != null) {
    return Number(benefit.points_amount) * Number(card.reward_currency.point_value_cents) / 100;
  }
  if (benefit.amount_usd != null) return Number(benefit.amount_usd);
  return null;
}

function countsTowardValue(benefit) {
  if (benefit.valuation?.method === "excluded") return false;
  const behavior = trackingType(benefit);
  return behavior === "spend" || (behavior === "automatic" && Number(benefit.points_amount) > 0);
}

function preferenceFor(map, walletCardId, benefit) {
  const stored = map.get(`${walletCardId}:${benefit.id}`);
  if (stored) return stored;
  return {
    probability: 1,
    personal_value_percent: 1,
    face_value_override: null,
    reminder_days: null,
  };
}

function usageFor(usage, walletCardId, benefitId, start, end) {
  return usage
    .filter((item) => item.wallet_card_id === walletCardId && item.benefit_id === benefitId && item.used_at >= start && item.used_at <= end)
    .reduce((sum, item) => sum + item.amount_usd, 0);
}

function daysUntil(date, asOf) {
  return Math.ceil((utcDate(date).getTime() - utcDate(asOf).getTime()) / DAY_MS);
}

function resetPeriodStatus({ remaining, used, start, end, asOf }) {
  if (remaining <= 0) return "used";
  if (end < asOf) return used > 0 ? "partial" : "expired";
  if (start > asOf) return "upcoming";
  return used > 0 ? "partial" : "available";
}

function resetPeriodTimeline(benefit, card, wallet, preference, usage, asOf) {
  if (trackingType(benefit) !== "spend" || !isResetCadence(benefit.cadence)) return [];
  const face = cycleAmount(benefit, card, preference);
  if (face == null) return [];
  const year = utcDate(asOf).getUTCFullYear();
  return enumerateCycles(benefit, wallet, `${year}-01-01`, `${year}-12-31`).map((window) => {
    const used = usageFor(usage, wallet.id, benefit.id, window.start, window.end);
    const remaining = Math.max(0, Number(face) - used);
    const isCurrent = window.start <= asOf && window.end >= asOf;
    return {
      key: window.key,
      label: RESET_CADENCE_LABELS[benefit.cadence](window),
      start: window.start,
      end: window.end,
      amount_usd: round(face),
      used_usd: round(used),
      remaining_usd: round(remaining),
      status: resetPeriodStatus({ remaining, used, start: window.start, end: window.end, asOf }),
      is_current: isCurrent,
    };
  });
}

function currentCycleState(benefit, card, wallet, preference, usage, savedStatus, asOf) {
  const behavior = trackingType(benefit);
  const face = cycleAmount(benefit, card, preference);
  const catalog = catalogValue(benefit, card, preference);
  const missingMembershipYear = benefit.cadence === "anniversary" && !membershipAnchor(wallet);
  if (missingMembershipYear) {
    return {
      id: benefit.id,
      title: benefit.title,
      kind: benefit.kind,
      cadence: benefit.cadence,
      description: benefit.description,
      tracking_type: behavior,
      amount_usd: face == null ? null : round(face),
      points_amount: benefit.points_amount == null ? null : Number(benefit.points_amount),
      catalog_value_usd: catalog == null ? null : round(catalog),
      valuation_method: benefit.valuation?.method || null,
      valuation_basis: benefit.valuation?.basis || null,
      valuation_source_url: benefit.valuation?.source_url || null,
      valuation_as_of: benefit.valuation?.as_of || null,
      used_usd: 0,
      remaining_usd: null,
      expected_value_usd: null,
      probability: preference.probability,
      personal_value_percent: preference.personal_value_percent,
      cycle_start: null,
      expires_on: null,
      days_remaining: null,
      status: savedStatus?.status || null,
      activated_on: savedStatus?.activated_on || null,
      requires_membership_year: true,
      counts_toward_value: countsTowardValue(benefit),
      periods: [],
      is_actionable: true,
    };
  }
  const windows = enumerateCycles(benefit, wallet, asOf, asOf);
  const window = windows.find((item) => item.start <= asOf && item.end >= asOf) || null;
  if (!window) return null;
  const used = behavior === "spend" ? usageFor(usage, wallet.id, benefit.id, window.start, window.end) : 0;
  const remaining = behavior === "spend" && face != null ? Math.max(0, Number(face) - used) : behavior === "automatic" ? 0 : null;
  const remainingShare = behavior === "spend" && face > 0 && remaining != null ? remaining / face : 0;
  const expected = behavior === "spend" && remaining != null && catalog != null
    ? catalog * remainingShare * preference.probability * preference.personal_value_percent
    : behavior === "automatic" && countsTowardValue(benefit) && catalog != null
      ? catalog * preference.probability * preference.personal_value_percent
      : null;
  const status = behavior === "automatic" ? "automatic" : savedStatus?.status || (behavior === "enrollment" ? "inactive" : null);
  const expiresOn = behavior === "spend" ? window.end : null;
  return {
    id: benefit.id,
    title: benefit.title,
    kind: benefit.kind,
    cadence: benefit.cadence,
    description: benefit.description,
    tracking_type: behavior,
    amount_usd: face == null ? null : round(face),
    points_amount: benefit.points_amount == null ? null : Number(benefit.points_amount),
    catalog_value_usd: catalog == null ? null : round(catalog),
    valuation_method: benefit.valuation?.method || null,
    valuation_basis: benefit.valuation?.basis || null,
    valuation_source_url: benefit.valuation?.source_url || null,
    valuation_as_of: benefit.valuation?.as_of || null,
    used_usd: round(used),
    remaining_usd: remaining == null ? null : round(remaining),
    expected_value_usd: expected == null ? null : round(expected),
    probability: preference.probability,
    personal_value_percent: preference.personal_value_percent,
    cycle_start: window.start,
    expires_on: expiresOn,
    days_remaining: expiresOn ? daysUntil(expiresOn, asOf) : null,
    status,
    activated_on: savedStatus?.activated_on || null,
    requires_membership_year: false,
    counts_toward_value: countsTowardValue(benefit),
    periods: resetPeriodTimeline(benefit, card, wallet, preference, usage, asOf),
    is_actionable: (behavior === "spend" && remaining > 0) || (behavior === "enrollment" && status !== "active"),
  };
}

function annualProjection(benefit, card, wallet, preference, usage, year, asOf) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (trackingType(benefit) !== "spend") return { remaining: 0, expected: 0 };
  const face = cycleAmount(benefit, card, preference);
  const catalog = catalogValue(benefit, card, preference);
  if (face == null) return { remaining: 0, expected: 0 };
  let remaining = 0;
  let expected = 0;
  for (const window of enumerateCycles(benefit, wallet, yearStart, yearEnd)) {
    if (window.end < asOf) continue;
    const used = usageFor(usage, wallet.id, benefit.id, window.start, window.end);
    const cycleRemaining = Math.max(0, Number(face) - used);
    remaining += cycleRemaining;
    const remainingShare = face > 0 ? cycleRemaining / face : 0;
    expected += (catalog ?? 0) * remainingShare * preference.probability * preference.personal_value_percent;
  }
  return { remaining, expected };
}

function automaticProjection(benefit, card, wallet, preference, year, asOf) {
  if (trackingType(benefit) !== "automatic" || !countsTowardValue(benefit)) return { realized: 0, expected: 0 };
  const catalog = catalogValue(benefit, card, preference);
  if (catalog == null) return { realized: 0, expected: 0 };
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  let realized = 0;
  let expected = 0;
  for (const window of enumerateCycles(benefit, wallet, yearStart, yearEnd)) {
    if (window.start < yearStart || window.start > yearEnd) continue;
    const value = Number(catalog) * preference.probability * preference.personal_value_percent;
    if (window.start <= asOf) realized += value;
    else expected += value;
  }
  return { realized, expected };
}

function feeRenewalReminder(wallet, card, asOf, threshold) {
  const anchor = membershipAnchor(wallet);
  if (!anchor) return null;
  const anchorDate = utcDate(anchor);
  const today = utcDate(asOf);
  let next = clampDay(today.getUTCFullYear(), anchorDate.getUTCMonth(), anchorDate.getUTCDate());
  if (next < today) next = clampDay(today.getUTCFullYear() + 1, anchorDate.getUTCMonth(), anchorDate.getUTCDate());
  const days = daysUntil(iso(next), asOf);
  if (days > threshold) return null;
  const fee = wallet.annual_fee_override ?? card.annual_fee_usd;
  return {
    type: "annual_fee",
    severity: days <= 7 ? "urgent" : "upcoming",
    wallet_card_id: wallet.id,
    card_name: card.name,
    title: `${card.short_name || card.name} renews in ${days} day${days === 1 ? "" : "s"}`,
    detail: fee == null ? "Review this card before renewal" : `$${round(fee, 0)} annual fee`,
    expires_on: iso(next),
    remaining_usd: null,
  };
}

export function buildDashboard({ catalog, db, asOf = new Date().toISOString().slice(0, 10), reminderDays = 30 }) {
  const wallet = listWalletCards(db);
  const usage = listUsage(db);
  const preferences = listPreferences(db);
  const benefitStatuses = listBenefitStatuses(db);
  const offers = listOffers(db, { activeOn: asOf });
  const preferenceMap = new Map(preferences.map((item) => [`${item.wallet_card_id}:${item.benefit_id}`, item]));
  const statusMap = new Map(benefitStatuses.map((item) => [`${item.wallet_card_id}:${item.benefit_id}`, item]));
  const catalogMap = new Map(catalog.map((card) => [card.slug, card]));
  const year = utcDate(asOf).getUTCFullYear();
  const yearStart = `${year}-01-01`;
  const cards = [];
  const reminders = [];

  for (const walletCard of wallet) {
    const card = catalogMap.get(walletCard.catalog_slug);
    if (!card) continue;
    let remaining = 0;
    let expected = 0;
    let automaticRealized = 0;
    let automaticExpected = 0;
    const benefitStates = [];
    for (const benefit of card.benefits) {
      const preference = preferenceFor(preferenceMap, walletCard.id, benefit);
      const savedStatus = statusMap.get(`${walletCard.id}:${benefit.id}`) || null;
      const state = currentCycleState(benefit, card, walletCard, preference, usage, savedStatus, asOf);
      if (state) {
        benefitStates.push(state);
        const threshold = preference.reminder_days ?? reminderDays;
        if (state.tracking_type === "spend" && state.remaining_usd > 0 && state.days_remaining <= threshold) {
          reminders.push({
            type: "benefit",
            severity: state.days_remaining <= 5 ? "urgent" : "upcoming",
            wallet_card_id: walletCard.id,
            card_name: card.name,
            benefit_id: state.id,
            title: `${state.title} expires in ${state.days_remaining} day${state.days_remaining === 1 ? "" : "s"}`,
            detail: `$${round(state.remaining_usd, 0)} remaining`,
            expires_on: state.expires_on,
            remaining_usd: state.remaining_usd,
          });
        }
      }
      const projection = annualProjection(benefit, card, walletCard, preference, usage, year, asOf);
      remaining += projection.remaining;
      expected += projection.expected;
      const automatic = automaticProjection(benefit, card, walletCard, preference, year, asOf);
      automaticRealized += automatic.realized;
      automaticExpected += automatic.expected;
    }
    const benefitMap = new Map(card.benefits.map((benefit) => [benefit.id, benefit]));
    const loggedRealized = usage
      .filter((item) => item.wallet_card_id === walletCard.id && item.used_at >= yearStart && item.used_at <= asOf)
      .reduce((sum, item) => {
        const benefit = benefitMap.get(item.benefit_id);
        if (!benefit || trackingType(benefit) !== "spend") return sum;
        const preference = preferenceFor(preferenceMap, walletCard.id, benefit);
        const nominalValue = cycleAmount(benefit, card, preference);
        const sourcedValue = catalogValue(benefit, card, preference);
        if (!(nominalValue > 0) || sourcedValue == null) return sum;
        return sum + Number(item.amount_usd) * Number(sourcedValue) / Number(nominalValue);
      }, 0);
    const realized = loggedRealized + automaticRealized;
    expected += automaticExpected;
    const annualFee = walletCard.annual_fee_override ?? card.annual_fee_usd ?? 0;
    const feeReminder = feeRenewalReminder(walletCard, card, asOf, reminderDays);
    if (feeReminder) reminders.push(feeReminder);
    const actionableStates = benefitStates.filter((state) => state.is_actionable);
    const nextAction = actionableStates
      .map((state) => state.expires_on)
      .filter(Boolean)
      .sort()[0] || null;
    cards.push({
      ...walletCard,
      name: card.name,
      short_name: card.short_name,
      issuer: card.issuer,
      image_url: card.image_url || null,
      image_alt: card.image_alt || `${card.name} card`,
      annual_fee_usd: round(annualFee),
      reward_currency: card.reward_currency,
      verification_status: card.verification_status,
      offer_ecosystem: card.offer_ecosystem,
      logged_realized_ytd_usd: round(loggedRealized),
      automatic_realized_ytd_usd: round(automaticRealized),
      realized_ytd_usd: round(realized),
      remaining_usd: round(remaining),
      expected_remaining_usd: round(expected),
      projected_net_usd: round(realized - annualFee),
      actionable_benefits_count: actionableStates.length,
      needs_attention: actionableStates.length > 0,
      next_action_date: nextAction,
      benefits: benefitStates.sort((a, b) => {
        if (a.is_actionable !== b.is_actionable) return a.is_actionable ? -1 : 1;
        return (a.expires_on || "9999-12-31").localeCompare(b.expires_on || "9999-12-31");
      }),
    });
  }

  cards.sort((a, b) => {
    if (a.needs_attention !== b.needs_attention) return a.needs_attention ? -1 : 1;
    const dateOrder = (a.next_action_date || "9999-12-31").localeCompare(b.next_action_date || "9999-12-31");
    return dateOrder || a.nickname.localeCompare(b.nickname);
  });

  for (const offer of offers) {
    if (!offer.expires_on) continue;
    const days = daysUntil(offer.expires_on, asOf);
    if (days <= reminderDays) {
      const walletCard = cards.find((item) => item.id === offer.wallet_card_id);
      reminders.push({
        type: "offer",
        severity: days <= 5 ? "urgent" : "upcoming",
        wallet_card_id: offer.wallet_card_id,
        card_name: walletCard?.name ?? "Card",
        offer_id: offer.id,
        title: `${offer.merchant} offer expires in ${days} day${days === 1 ? "" : "s"}`,
        detail: offer.reward_amount_usd ? `$${round(offer.reward_amount_usd, 0)} available` : offer.title,
        expires_on: offer.expires_on,
        remaining_usd: offer.reward_amount_usd,
      });
    }
  }

  const realizedYtd = cards.reduce((sum, card) => sum + card.realized_ytd_usd, 0);
  const creditsRemaining = cards.reduce((sum, card) => sum + card.remaining_usd, 0);
  const expectedRemaining = cards.reduce((sum, card) => sum + card.expected_remaining_usd, 0);
  const annualFees = cards.reduce((sum, card) => sum + card.annual_fee_usd, 0);
  const offersAvailable = offers.reduce((sum, offer) => sum + (offer.reward_amount_usd || 0), 0);
  const projectedNet = realizedYtd - annualFees;

  return {
    as_of: asOf,
    metrics: {
      realized_ytd_usd: round(realizedYtd),
      credits_remaining_usd: round(creditsRemaining),
      expected_remaining_usd: round(expectedRemaining),
      targeted_offers_usd: round(offersAvailable),
      annual_fees_usd: round(annualFees),
      projected_net_usd: round(projectedNet),
    },
    cards,
    reminders: reminders.sort((a, b) => a.expires_on.localeCompare(b.expires_on)),
    offers,
    catalog_cards: catalog.map((card) => ({
      slug: card.slug,
      name: card.name,
      short_name: card.short_name,
      issuer: card.issuer,
      annual_fee_usd: card.annual_fee_usd,
      point_value_cents: card.reward_currency?.point_value_cents ?? null,
      verification_status: card.verification_status,
      verified_at: card.verified_at,
      image_url: card.image_url || null,
      image_alt: card.image_alt || `${card.name} card`,
      benefits_count: card.benefits.length,
      reward_rules_count: card.reward_rules.length,
    })),
  };
}

function rewardValue(rule, card, amount) {
  if (!rule || rule.rate == null) return 0;
  if (rule.rate_type === "cashback_percent") return amount * rule.rate / 100;
  if (rule.rate_type === "points_multiplier") {
    const cpp = card.reward_currency?.point_value_cents ?? card.reward_currency?.cash_floor_cents ?? 1;
    return amount * rule.rate * cpp / 100;
  }
  return 0;
}

function ruleMatches(rule, query) {
  const valid = (!rule.valid_from || query.asOf >= rule.valid_from) && (!rule.valid_to || query.asOf <= rule.valid_to);
  if (!valid) return false;
  if (rule.conditional && !query.merchant) return false;
  const haystack = `${query.category} ${query.merchant || ""}`.toLowerCase();
  if (rule.category && haystack.includes(String(rule.category).toLowerCase())) return true;
  return (rule.match_terms || []).some((term) => haystack.includes(String(term).toLowerCase()));
}

export function recommendCard({ catalog, db, category, merchant = "", amount = 100, asOf = new Date().toISOString().slice(0, 10) }) {
  if (!category && !merchant) throw new Error("category or merchant is required");
  const wallet = listWalletCards(db);
  const offers = listOffers(db, { activeOn: asOf });
  const catalogMap = new Map(catalog.map((card) => [card.slug, card]));
  const results = [];
  for (const walletCard of wallet) {
    const card = catalogMap.get(walletCard.catalog_slug);
    if (!card) continue;
    const matches = card.reward_rules.filter((rule) => ruleMatches(rule, { category, merchant, asOf }));
    const rule = matches.sort((a, b) => rewardValue(b, card, amount) - rewardValue(a, card, amount))[0] || card.base_reward;
    const baseValue = rewardValue(rule, card, amount);
    const matchingOffers = offers.filter((offer) => {
      if (offer.wallet_card_id !== walletCard.id || !offer.activated || !merchant) return false;
      return merchant.toLowerCase().includes(offer.merchant.toLowerCase()) || offer.merchant.toLowerCase().includes(merchant.toLowerCase());
    });
    const offerValue = matchingOffers.reduce((sum, offer) => {
      if (offer.spend_requirement_usd && amount < offer.spend_requirement_usd) return sum;
      if (offer.reward_amount_usd) return sum + offer.reward_amount_usd;
      if (offer.reward_percent) return sum + amount * offer.reward_percent / 100;
      return sum;
    }, 0);
    results.push({
      wallet_card_id: walletCard.id,
      card_name: card.name,
      nickname: walletCard.nickname,
      last_four: walletCard.last_four,
      rule: rule?.label || "Base earn",
      rate: rule?.rate ?? null,
      rate_type: rule?.rate_type ?? "text_only",
      point_value_cents: card.reward_currency?.point_value_cents ?? null,
      reward_value_usd: round(baseValue),
      offer_value_usd: round(offerValue),
      total_value_usd: round(baseValue + offerValue),
      matching_offers: matchingOffers.map((offer) => offer.title),
    });
  }
  return {
    category,
    merchant,
    amount_usd: Number(amount),
    recommendation: results.sort((a, b) => b.total_value_usd - a.total_value_usd),
  };
}
