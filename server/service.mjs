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
  addUsage,
  addWalletCard,
  findWalletCard,
  listWalletCards,
  openDatabase,
  setBenefitStatus,
  setPreference,
  setWalletCardStatus,
  updateWalletCard,
} from "./db.mjs";
import { buildDashboard, recommendCard } from "./engine.mjs";
import { readFile, readdir } from "node:fs/promises";

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
    return loadCatalog(catalogDir);
  }

  return {
    db,
    paths: { ...paths, catalogDir, dbPath: options.dbPath || paths.dbPath },

    async dashboard() {
      return buildDashboard({ catalog: await catalog(), db, asOf: today() });
    },

    async reminders(days = 30) {
      const dashboard = buildDashboard({ catalog: await catalog(), db, asOf: today(), reminderDays: Number(days) });
      return { as_of: dashboard.as_of, days: Number(days), reminders: dashboard.reminders };
    },

    async recommend({ category, merchant, amount }) {
      return recommendCard({ catalog: await catalog(), db, category, merchant, amount: Number(amount || 100), asOf: today() });
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

    async addUsage(input) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      const card = (await catalog()).find((item) => item.slug === wallet.catalog_slug);
      const benefit = card?.benefits.find((item) => item.id === input.benefit_id);
      if (!benefit) throw new Error("benefit not found for wallet card");
      if ((benefit.tracking_type || "spend") !== "spend") throw new Error("this benefit does not use the spend ledger");
      return addUsage(db, { ...input, wallet_card_id: wallet.id });
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

    setPreference(input) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      return setPreference(db, { ...input, wallet_card_id: wallet.id });
    },

    addOffer(input) {
      const wallet = findWalletCard(db, input.wallet_card_id || input.card);
      if (!wallet) throw new Error("wallet card not found");
      return addOffer(db, { ...input, wallet_card_id: wallet.id });
    },

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
      return upsertBenefit(catalogDir, cardSlug, input);
    },

    async upsertRewardRule(cardSlug, input) {
      return upsertRewardRule(catalogDir, cardSlug, input);
    },

    async patchCardFacts(cardSlug, input) {
      return patchCardFacts(catalogDir, cardSlug, input);
    },

    walletCards() {
      return listWalletCards(db, { includeClosed: true });
    },
  };
}
