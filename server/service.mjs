import path from "node:path";
import {
  importCatalogCsv,
  loadCatalog,
  parseCsv,
  patchCardFacts,
  slugify,
  upsertBenefit,
  upsertRewardRule,
  validateCard,
} from "./catalog.mjs";
import {
  addOffer,
  addWalletCard,
  findWalletCard,
  listWalletCards,
  openDatabase,
  setBenefitStatus,
  setPreference,
  setWalletCardStatus,
  updateWalletCard,
  writePeriodUsage,
  writePeriodEvidence,
  listPreferences,
  usageHistory,
  updateOffer,
} from "./db.mjs";
import { buildDashboard, enumerateCycles, recommendCard, cycleAmount, catalogValue, resolveBenefitSchedule, isResetCadence } from "./engine.mjs";
import { readFile, readdir } from "node:fs/promises";
import { writeAward } from "./awards.mjs";

export function projectPaths(root = process.env.CRDITS_ROOT || process.cwd()) {
  return {
    root,
    catalogDir: process.env.CRDITS_CATALOG_DIR || path.join(root, "catalog", "cards"),
    dbPath: process.env.CRDITS_DB_PATH || path.join(root, ".data", "crdits.sqlite"),
  };
}

export function createService(options = {}) {
  const paths = projectPaths(options.root);
  const db = openDatabase(options.dbPath || paths.dbPath);
  const catalogDir = options.catalogDir || paths.catalogDir;
  const today = () => options.asOf || new Date().toISOString().slice(0, 10);

  async function catalog() {
    const cards = await loadCatalog(catalogDir);
    // Pin pre-migration usage at the existing catalog valuation once. This is
    // a migration-time estimate, not a claim about historical redemption prices.
    const legacy = db.prepare("SELECT * FROM benefit_usage WHERE value_ratio IS NULL").all();
    const wallets = listWalletCards(db, { includeClosed: true });
    const preferences = listPreferences(db);
    if (legacy.length) {
      const update = db.prepare("UPDATE benefit_usage SET value_ratio = ?, catalog_verified_at = ? WHERE id = ? AND value_ratio IS NULL");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const entry of legacy) {
          const wallet = wallets.find(item => item.id === entry.wallet_card_id);
          const card = cards.find(item => item.slug === wallet?.catalog_slug);
          const benefit = card?.benefits.find(item => item.id === entry.benefit_id);
          if (!benefit) continue;
          const preference = preferences.find(item => item.wallet_card_id === wallet.id && item.benefit_id === benefit.id) || {};
          const nominal = cycleAmount(benefit, card, preference);
          const value = benefit.redemption_policy ? 0 : catalogValue(benefit, card, preference);
          update.run(nominal > 0 && value != null ? value / nominal : 0, `migration:${card.verified_at || today()}`, entry.id);
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    return cards;
  }

  return {
    db,
    paths: { ...paths, catalogDir, dbPath: options.dbPath || paths.dbPath },

    async dashboard({ year } = {}) {
      const currentYear = Number(today().slice(0, 4));
      const selectedYear = year == null ? currentYear : Number(year);
      if (!Number.isInteger(selectedYear) || selectedYear < 2000 || selectedYear > currentYear) throw new Error("year must be between 2000 and the current year");
      return { ...buildDashboard({ catalog: await catalog(), db, asOf: selectedYear === currentYear ? today() : `${selectedYear}-12-31`, includeClosed: selectedYear < currentYear }), today: today(), selected_year: selectedYear };
    },

    async reminders(days = 30) {
      const dashboard = buildDashboard({ catalog: await catalog(), db, asOf: today(), reminderDays: Number(days) });
      return { as_of: dashboard.as_of, days: Number(days), reminders: dashboard.reminders };
    },

    async recommend({ category, merchant, amount, context = {} }) {
      return recommendCard({ catalog: await catalog(), db, category, merchant, amount: Number(amount ?? 100), context, asOf: today() });
    },

    async addWalletCard(input) {
      const cards = await catalog();
      if (!cards.some((card) => card.slug === input.catalog_slug)) throw new Error("catalog card not found");
      return addWalletCard(db, input);
    },

    updateWalletCard(identifier, input) {
      return updateWalletCard(db, identifier, input);
    },

    closeWalletCard(id) {
      return setWalletCardStatus(db, id, "closed");
    },

    async addUsage(input, { replace = false } = {}) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      const card = (await catalog()).find((item) => item.slug === wallet.catalog_slug);
      const definition = card?.benefits.find((item) => item.id === input.benefit_id);
      if (!definition) throw new Error("benefit not found for wallet card");
      const preference = listPreferences(db).find(item => item.wallet_card_id === wallet.id && item.benefit_id === definition.id) || {};
      const benefit = resolveBenefitSchedule(definition, preference);
      if (Object.hasOwn(input, "period_schedule_id") && input.period_schedule_id !== (benefit.period_schedule_id || null)) throw new Error("The offer schedule changed. Refresh before logging credit.");
      if ((benefit.tracking_type || "spend") !== "spend") throw new Error("this benefit does not use the spend ledger");
      const usedAt = input.used_at || today();
      const parsedUsedAt = new Date(`${usedAt}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(usedAt) || Number.isNaN(parsedUsedAt.getTime()) || parsedUsedAt.toISOString().slice(0, 10) !== usedAt) {
        throw new Error("used_at must be a valid YYYY-MM-DD date");
      }
      if (usedAt > today()) throw new Error("usage cannot be recorded in a future period");
      if (input.period_key) {
        const matchingPeriod = enumerateCycles(benefit, wallet, usedAt, usedAt).find((period) => period.key === input.period_key);
        if (!matchingPeriod) throw new Error(`usage date ${usedAt} does not fall inside ${input.period_key}`);
      }
      const period = enumerateCycles(benefit, wallet, usedAt, usedAt)[0];
      if (!period) throw new Error("No eligible credit period for this date; check the card anniversary and benefit dates");
      const limit = cycleAmount(benefit, card, preference);
      const value = catalogValue(benefit, card, preference);
      const policy = benefit.redemption_policy;
      const method = input.redemption_method || null;
      if (method && !policy?.options.some(option => option.id === method)) throw new Error("Invalid redemption method for this benefit.");
      if (input.revalue_existing != null && typeof input.revalue_existing !== "boolean") throw new Error("revalue_existing must be boolean");
      if (input.revalue_existing && (!replace || !policy || !method)) throw new Error("Reclassification requires a period correction and a redemption method.");
      if (input.revalue_existing && !Number.isFinite(Number(input.expected_value_usd))) throw new Error("expected_value_usd is required for reclassification");
      const ratio = policy ? policy.options.find(option => option.id === method)?.counted_unit_value_usd ?? 0 : limit > 0 && value != null ? value / limit : 0;
      return writePeriodUsage(db, { ...input, redemption_method: method, require_redemption_method: Boolean(policy), used_at: usedAt, wallet_card_id: wallet.id, value_ratio: ratio, catalog_verified_at: card.verified_at }, period, { limit, replace });
    },

    usageHistory(walletCardId, benefitId) {
      return usageHistory(db, Number(walletCardId), benefitId);
    },

    async saveAward(input) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      const card = (await catalog()).find(item => item.slug === wallet.catalog_slug);
      const benefit = card?.benefits.find(item => item.id === input.benefit_id);
      if (!benefit) throw new Error("benefit not found for wallet card");
      return writeAward(db, { ...input, wallet_card_id: wallet.id }, benefit, today());
    },

    async setPeriodEvidence(input) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      const card = (await catalog()).find(item => item.slug === wallet.catalog_slug);
      const definition = card?.benefits.find(item => item.id === input.benefit_id);
      if (!definition || definition.tracking_type !== "spend") throw new Error("evidence requires a spend-tracked benefit");
      const preference = listPreferences(db).find(item => item.wallet_card_id === wallet.id && item.benefit_id === definition.id) || {};
      const benefit = resolveBenefitSchedule(definition, preference);
      if (!isResetCadence(benefit.cadence)) throw new Error("evidence requires a period-tracked benefit");
      if (Object.hasOwn(input, "period_schedule_id") && input.period_schedule_id !== (benefit.period_schedule_id || null)) throw new Error("The offer schedule changed. Refresh before saving evidence.");
      const date = input.used_at;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("used_at must be a valid YYYY-MM-DD date");
      if (date > today()) throw new Error("evidence cannot be recorded in a future period");
      const period = enumerateCycles(benefit, wallet, date, date).find(item => item.key === input.period_key);
      if (!period) throw new Error("evidence date does not fall inside the selected eligible period");
      return writePeriodEvidence(db, { ...input, wallet_card_id: wallet.id }, period);
    },

    async catalogCard(slug) {
      const card = (await catalog()).find(item => item.slug === slug);
      if (!card) throw new Error("catalog card not found");
      return card;
    },

    async setBenefitStatus(input) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      const card = (await catalog()).find((item) => item.slug === wallet.catalog_slug);
      const benefit = card?.benefits.find((item) => item.id === input.benefit_id);
      if (!benefit) throw new Error("benefit not found for wallet card");
      if ((benefit.tracking_type || "spend") !== "enrollment") throw new Error("only enrollment benefits have persistent status");
      return setBenefitStatus(db, { ...input, wallet_card_id: wallet.id });
    },

    async setPreference(input) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      const card = (await catalog()).find(item => item.slug === wallet.catalog_slug);
      const benefit = card?.benefits.find(item => item.id === input.benefit_id);
      if (!benefit) throw new Error("benefit not found for wallet card");
      if (Object.hasOwn(input, "period_schedule_id") && !benefit.period_schedules?.some(item => item.id === input.period_schedule_id)) throw new Error("Invalid offer schedule for this benefit");
      const current = listPreferences(db).find(item => item.wallet_card_id === wallet.id && item.benefit_id === benefit.id);
      if (Object.hasOwn(input, "expected_schedule_id") && input.expected_schedule_id !== (current?.period_schedule_id || benefit.default_schedule_id)) throw new Error("The offer schedule changed in another session. Refresh before saving.");
      return setPreference(db, { probability: 1, personal_value_percent: 1, ...current, ...input, wallet_card_id: wallet.id });
    },

    addOffer(input) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      return addOffer(db, { ...input, wallet_card_id: wallet.id });
    },

    updateOffer(id, input) { return updateOffer(db, id, input); },

    async importCatalogCsv(csvPath) {
      return importCatalogCsv(csvPath, catalogDir);
    },

    async importWalletCsv(csvPath) {
      const rows = parseCsv(await readFile(csvPath, "utf8"));
      const cards = await catalog();
      const catalogSlugs = new Set(cards.map((card) => card.slug));
      const imported = [];
      for (const row of rows) {
        const cardSlug = slugify(row.exact_card_name || row.screenshot_label);
        if (!catalogSlugs.has(cardSlug)) continue;
        imported.push(addWalletCard(db, {
          catalog_slug: cardSlug,
          nickname: row.screenshot_label || row.exact_card_name,
          status: "active",
        }));
      }
      return imported;
    },

    async validateCatalog() {
      const files = (await readdir(catalogDir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
      const results = [];
      for (const file of files) {
        const card = JSON.parse(await readFile(path.join(catalogDir, file.name), "utf8"));
        results.push({ file: file.name, slug: card.slug, errors: validateCard(card) });
      }
      return {
        valid: results.every((result) => result.errors.length === 0),
        cards: results.length,
        results,
      };
    },

    async staleCatalog(days = 45) {
      const cutoff = new Date(`${today()}T00:00:00Z`);
      cutoff.setUTCDate(cutoff.getUTCDate() - Number(days));
      const cutoffIso = cutoff.toISOString().slice(0, 10);
      return (await catalog())
        .filter((card) => !card.verified_at || card.verified_at < cutoffIso || /NEEDS_CONFIRMATION|ASSUMED/.test(card.verification_status))
        .map((card) => ({ slug: card.slug, name: card.name, verification_status: card.verification_status, verified_at: card.verified_at, primary_source_url: card.sources.find((source) => source.kind === "primary")?.url ?? null }));
    },

    async upsertBenefit(cardSlug, input) {
      await catalog();
      return upsertBenefit(catalogDir, cardSlug, input);
    },

    async upsertRewardRule(cardSlug, input) {
      await catalog();
      return upsertRewardRule(catalogDir, cardSlug, input);
    },

    async patchCardFacts(cardSlug, input) {
      await catalog();
      return patchCardFacts(catalogDir, cardSlug, input);
    },

    walletCards() {
      return listWalletCards(db, { includeClosed: true });
    },
  };
}
