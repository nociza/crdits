import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const CATEGORY_TERMS = {
  dining: ["dining", "restaurant", "restaurants", "resy", "grubhub", "doordash"],
  groceries: ["grocery", "groceries", "supermarket", "supermarkets", "whole foods"],
  gas: ["gas", "fuel", "ev charging"],
  travel: ["travel", "hotel", "hotels", "flight", "flights", "airline", "airlines", "rental car", "vacation rental"],
  transit: ["transit", "commuting", "rideshare", "lyft", "uber"],
  drugstores: ["drugstore", "drugstores", "pharmacy"],
  streaming: ["streaming", "apple tv", "disney", "hulu"],
  amazon: ["amazon", "audible"],
  fitness: ["fitness", "gym", "peloton"],
  housing: ["rent", "mortgage", "hoa", "housing"],
  entertainment: ["entertainment", "concert", "venue"],
};

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function splitItems(value) {
  return String(value ?? "")
    .split(/\s*;\s*/)
    .map((item) => item.trim())
    .filter((item) => item && !/^(see terms|subject to terms|verify current terms)$/i.test(item));
}

function cadenceFor(text) {
  const lower = text.toLowerCase();
  if (/\b(monthly|per month)\b|\/month|\/mo\b/.test(lower)) return { cadence: "monthly" };
  if (/\b(quarterly|per quarter)\b/.test(lower)) return { cadence: "quarterly" };
  if (/semiannual|semi-annual|jan\s*[-–]\s*jun|jul\s*[-–]\s*dec|twice (?:a|per) year/.test(lower)) return { cadence: "semiannual" };
  if (/anniversary|renewal/.test(lower)) return { cadence: "anniversary" };
  const everyYears = lower.match(/every\s+(\d+)\s+years?/);
  if (everyYears) return { cadence: "every_n_years", interval_years: Number(everyYears[1]) };
  if (/\b(annual|annually|each year|calendar year|yearly)\b/.test(lower)) return { cadence: "annual" };
  return { cadence: "one_time" };
}

function cycleAmount(text, cadence) {
  const lower = text.toLowerCase();
  const patterns = cadence === "monthly"
    ? [/\$([\d,.]+)\s*(?:\/\s*(?:month|mo)|per month)/i]
    : cadence === "quarterly"
      ? [/\$([\d,.]+)\s*(?:per quarter|\/\s*quarter)/i]
      : cadence === "semiannual"
        ? [/split[^$]*\$([\d,.]+)/i, /\$([\d,.]+)\s+(?:jan\s*[-–]\s*jun|jul\s*[-–]\s*dec)/i]
        : [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return numberOrNull(match[1]);
  }
  const twoCredits = lower.match(/(?:two|2)\s+\$([\d,.]+)\s+credits?/i);
  if (twoCredits) return numberOrNull(twoCredits[1]);
  const first = text.match(/\$([\d,.]+)/);
  return first ? numberOrNull(first[1]) : null;
}

function benefitKind(text) {
  const lower = text.toLowerCase();
  if (/\$[\d,.]+/.test(text) && /credit|benefit|cash|rebate/.test(lower)) return "statement_credit";
  if (/free night|award|certificate/.test(lower)) return "certificate";
  if (/status|priority pass|dashpass|membership|complimentary/.test(lower)) return "membership";
  return "statement_credit";
}

function benefitTitle(text) {
  return text
    .replace(/^up to\s+/i, "")
    .replace(/^\$[\d,.]+\s*(?:\/\s*(?:month|mo)|per\s+(?:month|quarter))?\s*/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .split(/\s+(?:after|through|split|subject to|when)\b/i)[0]
    .trim()
    .replace(/[,:-]+$/, "")
    .slice(0, 90) || "Card benefit";
}

function trackingTypeFor(text, kind, amount) {
  const lower = text.toLowerCase();
  if (/automatically|automatic|anniversary miles|elite night credits/.test(lower)) return "automatic";
  if (kind === "membership" && /enroll|activation|activate/.test(lower)) return "enrollment";
  if (kind === "membership") return "automatic";
  if (amount == null) return "reference";
  return "spend";
}

function effectiveTo(text) {
  const year = text.match(/through\s+(20\d{2})/i)?.[1];
  return year ? `${year}-12-31` : null;
}

function researchYearStart(researchAsOf) {
  const year = String(researchAsOf || "").match(/^(\d{4})-/)?.[1];
  return year ? `${year}-01-01` : null;
}

export function parseBenefits(recurring, annual, researchAsOf) {
  const entries = [
    ...splitItems(recurring).map((text) => ({ text, sourceGroup: "recurring" })),
    ...splitItems(annual).map((text) => ({ text, sourceGroup: "annual_or_anniversary" })),
  ];
  const ids = new Map();
  return entries.map(({ text, sourceGroup }) => {
    const schedule = cadenceFor(text);
    const kind = benefitKind(text);
    const amount = cycleAmount(text, schedule.cadence);
    const baseId = slugify(benefitTitle(text)) || "benefit";
    const seen = ids.get(baseId) ?? 0;
    ids.set(baseId, seen + 1);
    return {
      id: seen ? `${baseId}-${seen + 1}` : baseId,
      title: benefitTitle(text),
      kind,
      tracking_type: trackingTypeFor(text, kind, amount),
      amount_usd: amount,
      cadence: schedule.cadence,
      interval_years: schedule.interval_years ?? null,
      description: text,
      eligibility: null,
      enrollment_required: /enroll|activation|activate/i.test(text),
      valid_from: researchYearStart(researchAsOf),
      valid_to: effectiveTo(text),
      source_group: sourceGroup,
    };
  });
}

function categoryFor(text) {
  const lower = text.toLowerCase();
  for (const [category, terms] of Object.entries(CATEGORY_TERMS)) {
    if (terms.some((term) => lower.includes(term))) return category;
  }
  return "other";
}

function termsFor(text) {
  const lower = text.toLowerCase();
  const terms = [];
  for (const candidates of Object.values(CATEGORY_TERMS)) {
    for (const term of candidates) if (lower.includes(term)) terms.push(term);
  }
  return [...new Set(terms)];
}

export function parseRewardRule(text, index = 0, researchAsOf = null) {
  const xMatch = text.match(/(\d+(?:\.\d+)?)\s*[xX]\b/);
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const rateType = xMatch ? "points_multiplier" : percentMatch ? "cashback_percent" : "text_only";
  const rate = numberOrNull(xMatch?.[1] ?? percentMatch?.[1]);
  return {
    id: `${categoryFor(text)}-${index + 1}`,
    category: categoryFor(text),
    label: text,
    match_terms: termsFor(text),
    rate,
    rate_type: rateType,
    activation_required: /activation|activate/i.test(text),
    cap_usd: numberOrNull(text.match(/up to\s+\$([\d,.]+)/i)?.[1]),
    conditional: /\b(up to|depending|rotating|select|portal|eligible)\b/i.test(text),
    valid_from: researchAsOf,
    valid_to: effectiveTo(text),
  };
}

export function cardFromCsvRow(row) {
  const name = row.exact_card_name?.trim() || row.screenshot_label?.trim() || "Unknown card";
  const researchAsOf = row.research_as_of || null;
  const pointValue = numberOrNull(row.point_value_reference_cents);
  const cashFloor = numberOrNull(row.cash_floor_cents);
  return {
    schema_version: 1,
    slug: slugify(name),
    name,
    short_name: row.screenshot_label || name,
    issuer: row.issuer || "Unknown",
    verification_status: row.verification_status || "NEEDS_CONFIRMATION",
    annual_fee_usd: numberOrNull(row.annual_fee_usd),
    foreign_transaction_fee: row.foreign_transaction_fee || null,
    reward_currency: {
      name: row.reward_currency || null,
      point_value_cents: pointValue,
      cash_floor_cents: cashFloor,
      valuation_basis: row.point_value_basis || null,
      valuation_source_url: row.valuation_source_url || null,
    },
    base_reward: parseRewardRule(row.base_earn || "", 0, researchAsOf),
    reward_rules: splitItems(row.bonus_categories).map((text, index) => parseRewardRule(text, index, researchAsOf)),
    benefits: parseBenefits(row.recurring_credits, row.annual_or_anniversary_benefits, researchAsOf),
    spend_threshold_benefits: splitItems(row.spend_threshold_benefits),
    offer_ecosystem: row.coupon_offer_ecosystem || null,
    other_key_benefits: splitItems(row.other_key_benefits),
    notes: row.important_2026_notes || null,
    valid_from: researchAsOf,
    valid_to: null,
    verified_at: researchAsOf,
    sources: [
      row.primary_source_url ? { kind: "primary", url: row.primary_source_url } : null,
      row.benefits_source_url ? { kind: "benefits", url: row.benefits_source_url } : null,
      row.valuation_source_url ? { kind: "valuation", url: row.valuation_source_url } : null,
    ].filter(Boolean),
    history: [],
    raw_source_fields: {
      base_earn: row.base_earn || "",
      bonus_categories: row.bonus_categories || "",
      recurring_credits: row.recurring_credits || "",
      annual_or_anniversary_benefits: row.annual_or_anniversary_benefits || "",
      spend_threshold_benefits: row.spend_threshold_benefits || "",
    },
  };
}

export function validateCard(card) {
  const errors = [];
  if (card?.schema_version !== 1) errors.push("schema_version must equal 1");
  if (!card?.slug || card.slug !== slugify(card.slug)) errors.push("slug must be lowercase kebab-case");
  if (!card?.name) errors.push("name is required");
  if (!card?.issuer) errors.push("issuer is required");
  if (!Array.isArray(card?.reward_rules)) errors.push("reward_rules must be an array");
  if (!Array.isArray(card?.benefits)) errors.push("benefits must be an array");
  const benefitIds = new Set();
  for (const benefit of card?.benefits ?? []) {
    if (!benefit.id || benefitIds.has(benefit.id)) errors.push(`benefit id must be unique: ${benefit.id ?? "missing"}`);
    benefitIds.add(benefit.id);
    if (!benefit.title) errors.push(`benefit ${benefit.id ?? "unknown"} needs a title`);
    if (!benefit.cadence) errors.push(`benefit ${benefit.id ?? "unknown"} needs a cadence`);
    if (!["spend", "automatic", "enrollment", "reference"].includes(benefit.tracking_type)) {
      errors.push(`benefit ${benefit.id ?? "unknown"} needs a valid tracking_type`);
    }
  }
  return errors;
}

export async function loadCatalog(catalogDir) {
  let entries = [];
  try {
    entries = await readdir(catalogDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const cards = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    const card = JSON.parse(await readFile(path.join(catalogDir, entry.name), "utf8"));
    const errors = validateCard(card);
    if (errors.length) throw new Error(`${entry.name}: ${errors.join("; ")}`);
    cards.push(card);
  }
  return cards;
}

export async function writeCard(catalogDir, card) {
  const errors = validateCard(card);
  if (errors.length) throw new Error(errors.join("; "));
  await mkdir(catalogDir, { recursive: true });
  const destination = path.join(catalogDir, `${card.slug}.json`);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(card, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return destination;
}

export async function importCatalogCsv(csvPath, catalogDir) {
  const rows = parseCsv(await readFile(csvPath, "utf8"));
  const cards = rows.map(cardFromCsvRow);
  for (const card of cards) await writeCard(catalogDir, card);
  return cards;
}

async function updateCard(catalogDir, cardSlug, updater) {
  const file = path.join(catalogDir, `${slugify(cardSlug)}.json`);
  const card = JSON.parse(await readFile(file, "utf8"));
  const updated = updater(structuredClone(card));
  updated.verified_at = updated.verified_at || new Date().toISOString().slice(0, 10);
  await writeCard(catalogDir, updated);
  return updated;
}

function archive(card, type, value) {
  card.history ??= [];
  card.history.push({ type, superseded_at: new Date().toISOString(), value });
}

export async function upsertBenefit(catalogDir, cardSlug, input) {
  return updateCard(catalogDir, cardSlug, (card) => {
    const id = slugify(input.id || input.title);
    const existingIndex = card.benefits.findIndex((benefit) => benefit.id === id);
    const existing = existingIndex >= 0 ? card.benefits[existingIndex] : null;
    if (existing) archive(card, "benefit", existing);
    const next = {
      id,
      title: input.title,
      kind: input.kind || "statement_credit",
      tracking_type: input.tracking_type || (input.enrollment_required ? "enrollment" : numberOrNull(input.amount_usd) == null ? "reference" : "spend"),
      amount_usd: numberOrNull(input.amount_usd),
      points_amount: numberOrNull(input.points_amount),
      cadence: input.cadence || "annual",
      interval_years: numberOrNull(input.interval_years),
      description: input.description || input.title,
      eligibility: input.eligibility || null,
      enrollment_required: Boolean(input.enrollment_required),
      valid_from: input.valid_from || new Date().toISOString().slice(0, 10),
      valid_to: input.valid_to || null,
      source_group: input.source_group || "community_update",
      source_url: input.source_url || null,
    };
    if (existingIndex >= 0) card.benefits[existingIndex] = next;
    else card.benefits.push(next);
    if (input.source_url && !card.sources.some((source) => source.url === input.source_url)) {
      card.sources.push({ kind: "benefits", url: input.source_url });
    }
    card.verified_at = input.verified_at || next.valid_from;
    return card;
  });
}

export async function upsertRewardRule(catalogDir, cardSlug, input) {
  return updateCard(catalogDir, cardSlug, (card) => {
    const id = slugify(input.id || input.category || input.label);
    const existingIndex = card.reward_rules.findIndex((rule) => rule.id === id);
    const existing = existingIndex >= 0 ? card.reward_rules[existingIndex] : null;
    if (existing) archive(card, "reward_rule", existing);
    const next = {
      id,
      category: input.category || "other",
      label: input.label || input.title || `${input.rate}${input.rate_type === "cashback_percent" ? "%" : "X"} ${input.category}`,
      match_terms: Array.isArray(input.match_terms)
        ? input.match_terms.map((term) => String(term).toLowerCase())
        : String(input.match_terms || input.category || "").split(",").map((term) => term.trim().toLowerCase()).filter(Boolean),
      rate: numberOrNull(input.rate),
      rate_type: input.rate_type || "points_multiplier",
      activation_required: Boolean(input.activation_required),
      cap_usd: numberOrNull(input.cap_usd),
      valid_from: input.valid_from || new Date().toISOString().slice(0, 10),
      valid_to: input.valid_to || null,
      source_url: input.source_url || null,
    };
    if (existingIndex >= 0) card.reward_rules[existingIndex] = next;
    else card.reward_rules.push(next);
    if (input.source_url && !card.sources.some((source) => source.url === input.source_url)) {
      card.sources.push({ kind: "rewards", url: input.source_url });
    }
    card.verified_at = input.verified_at || next.valid_from;
    return card;
  });
}

export async function patchCardFacts(catalogDir, cardSlug, input) {
  return updateCard(catalogDir, cardSlug, (card) => {
    if (input.annual_fee_usd !== undefined) card.annual_fee_usd = numberOrNull(input.annual_fee_usd);
    if (input.point_value_cents !== undefined) card.reward_currency.point_value_cents = numberOrNull(input.point_value_cents);
    if (input.cash_floor_cents !== undefined) card.reward_currency.cash_floor_cents = numberOrNull(input.cash_floor_cents);
    if (input.notes !== undefined) card.notes = input.notes || null;
    if (input.source_url && !card.sources.some((source) => source.url === input.source_url)) {
      card.sources.push({ kind: "primary", url: input.source_url });
    }
    card.verified_at = input.verified_at || new Date().toISOString().slice(0, 10);
    return card;
  });
}
