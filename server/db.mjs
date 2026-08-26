import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function ensureParent(file) {
  if (file === ":memory:") return;
  mkdirSync(path.dirname(file), { recursive: true });
}

export function openDatabase(dbPath) {
  ensureParent(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_slug TEXT NOT NULL,
      nickname TEXT NOT NULL,
      last_four TEXT,
      opened_on TEXT,
      renewal_date TEXT,
      annual_fee_override REAL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(catalog_slug, nickname)
    );

    CREATE TABLE IF NOT EXISTS benefit_preferences (
      wallet_card_id INTEGER NOT NULL REFERENCES wallet_cards(id) ON DELETE CASCADE,
      benefit_id TEXT NOT NULL,
      probability REAL NOT NULL DEFAULT 0.8 CHECK (probability >= 0 AND probability <= 1),
      personal_value_percent REAL NOT NULL DEFAULT 1 CHECK (personal_value_percent >= 0 AND personal_value_percent <= 1),
      face_value_override REAL,
      reminder_days INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(wallet_card_id, benefit_id)
    );

    CREATE TABLE IF NOT EXISTS benefit_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_card_id INTEGER NOT NULL REFERENCES wallet_cards(id) ON DELETE CASCADE,
      benefit_id TEXT NOT NULL,
      amount_usd REAL NOT NULL CHECK (amount_usd >= 0),
      used_at TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_card_id INTEGER NOT NULL REFERENCES wallet_cards(id) ON DELETE CASCADE,
      merchant TEXT NOT NULL,
      title TEXT NOT NULL,
      spend_requirement_usd REAL,
      reward_amount_usd REAL,
      reward_percent REAL,
      activated INTEGER NOT NULL DEFAULT 0,
      expires_on TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'used', 'expired')),
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS offer_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      amount_usd REAL NOT NULL CHECK (amount_usd >= 0),
      used_at TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_usage_card_benefit_date
      ON benefit_usage(wallet_card_id, benefit_id, used_at);
    CREATE INDEX IF NOT EXISTS idx_offers_card_expiry
      ON offers(wallet_card_id, expires_on);
    CREATE INDEX IF NOT EXISTS idx_wallet_status
      ON wallet_cards(status);
    PRAGMA optimize;
  `);
}

export function listWalletCards(db, { includeClosed = false } = {}) {
  const sql = includeClosed
    ? "SELECT * FROM wallet_cards ORDER BY status, nickname"
    : "SELECT * FROM wallet_cards WHERE status = 'active' ORDER BY nickname";
  return db.prepare(sql).all().map(normalizeWalletCard);
}

export function addWalletCard(db, input) {
  if (!input.catalog_slug) throw new Error("catalog_slug is required");
  const nickname = input.nickname || input.catalog_slug;
  const statement = db.prepare(`
    INSERT INTO wallet_cards (
      catalog_slug, nickname, last_four, opened_on, renewal_date,
      annual_fee_override, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(catalog_slug, nickname) DO UPDATE SET
      last_four = excluded.last_four,
      opened_on = COALESCE(excluded.opened_on, wallet_cards.opened_on),
      renewal_date = COALESCE(excluded.renewal_date, wallet_cards.renewal_date),
      annual_fee_override = COALESCE(excluded.annual_fee_override, wallet_cards.annual_fee_override),
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `);
  return normalizeWalletCard(statement.get(
    input.catalog_slug,
    nickname,
    input.last_four || null,
    input.opened_on || null,
    input.renewal_date || null,
    input.annual_fee_override ?? null,
    input.status || "active",
  ));
}

export function setWalletCardStatus(db, id, status) {
  if (!['active', 'closed'].includes(status)) throw new Error("status must be active or closed");
  const result = db.prepare("UPDATE wallet_cards SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *").get(status, id);
  if (!result) throw new Error("wallet card not found");
  return normalizeWalletCard(result);
}

export function findWalletCard(db, identifier) {
  if (identifier == null) return null;
  const numeric = Number(identifier);
  const row = Number.isInteger(numeric)
    ? db.prepare("SELECT * FROM wallet_cards WHERE id = ?").get(numeric)
    : db.prepare("SELECT * FROM wallet_cards WHERE catalog_slug = ? OR lower(nickname) = lower(?) ORDER BY status = 'active' DESC LIMIT 1").get(identifier, identifier);
  return row ? normalizeWalletCard(row) : null;
}

function normalizeWalletCard(row) {
  return {
    id: Number(row.id),
    catalog_slug: row.catalog_slug,
    nickname: row.nickname,
    last_four: row.last_four,
    opened_on: row.opened_on,
    renewal_date: row.renewal_date,
    annual_fee_override: row.annual_fee_override == null ? null : Number(row.annual_fee_override),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listUsage(db, { start = null, end = null, walletCardId = null } = {}) {
  const conditions = [];
  const values = [];
  if (start) { conditions.push("used_at >= ?"); values.push(start); }
  if (end) { conditions.push("used_at <= ?"); values.push(end); }
  if (walletCardId) { conditions.push("wallet_card_id = ?"); values.push(walletCardId); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM benefit_usage ${where} ORDER BY used_at DESC, id DESC`).all(...values).map((row) => ({
    id: Number(row.id),
    wallet_card_id: Number(row.wallet_card_id),
    benefit_id: row.benefit_id,
    amount_usd: Number(row.amount_usd),
    used_at: row.used_at,
    note: row.note,
  }));
}

export function addUsage(db, input) {
  if (!input.wallet_card_id || !input.benefit_id) throw new Error("wallet_card_id and benefit_id are required");
  const amount = Number(input.amount_usd);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("amount_usd must be a non-negative number");
  const usedAt = input.used_at || new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    INSERT INTO benefit_usage (wallet_card_id, benefit_id, amount_usd, used_at, note)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(input.wallet_card_id, input.benefit_id, amount, usedAt, input.note || null);
  return {
    id: Number(row.id),
    wallet_card_id: Number(row.wallet_card_id),
    benefit_id: row.benefit_id,
    amount_usd: Number(row.amount_usd),
    used_at: row.used_at,
    note: row.note,
  };
}

export function listPreferences(db) {
  return db.prepare("SELECT * FROM benefit_preferences").all().map((row) => ({
    wallet_card_id: Number(row.wallet_card_id),
    benefit_id: row.benefit_id,
    probability: Number(row.probability),
    personal_value_percent: Number(row.personal_value_percent),
    face_value_override: row.face_value_override == null ? null : Number(row.face_value_override),
    reminder_days: row.reminder_days == null ? null : Number(row.reminder_days),
  }));
}

export function setPreference(db, input) {
  const probability = input.probability == null ? 0.8 : Number(input.probability);
  const personal = input.personal_value_percent == null ? 1 : Number(input.personal_value_percent);
  if (probability < 0 || probability > 1 || personal < 0 || personal > 1) {
    throw new Error("probability and personal_value_percent must be between 0 and 1");
  }
  db.prepare(`
    INSERT INTO benefit_preferences (
      wallet_card_id, benefit_id, probability, personal_value_percent,
      face_value_override, reminder_days, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(wallet_card_id, benefit_id) DO UPDATE SET
      probability = excluded.probability,
      personal_value_percent = excluded.personal_value_percent,
      face_value_override = excluded.face_value_override,
      reminder_days = excluded.reminder_days,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    input.wallet_card_id,
    input.benefit_id,
    probability,
    personal,
    input.face_value_override ?? null,
    input.reminder_days ?? null,
  );
  return { ...input, probability, personal_value_percent: personal };
}

export function listOffers(db, { activeOn = null } = {}) {
  const rows = activeOn
    ? db.prepare("SELECT * FROM offers WHERE status = 'available' AND (expires_on IS NULL OR expires_on >= ?) ORDER BY expires_on IS NULL, expires_on, merchant").all(activeOn)
    : db.prepare("SELECT * FROM offers ORDER BY status, expires_on IS NULL, expires_on, merchant").all();
  return rows.map(normalizeOffer);
}

export function addOffer(db, input) {
  if (!input.wallet_card_id || !input.merchant || !input.title) throw new Error("wallet_card_id, merchant, and title are required");
  const row = db.prepare(`
    INSERT INTO offers (
      wallet_card_id, merchant, title, spend_requirement_usd,
      reward_amount_usd, reward_percent, activated, expires_on,
      status, source, note, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    RETURNING *
  `).get(
    input.wallet_card_id,
    input.merchant,
    input.title,
    input.spend_requirement_usd ?? null,
    input.reward_amount_usd ?? null,
    input.reward_percent ?? null,
    input.activated ? 1 : 0,
    input.expires_on || null,
    input.status || "available",
    input.source || null,
    input.note || null,
  );
  return normalizeOffer(row);
}

function normalizeOffer(row) {
  return {
    id: Number(row.id),
    wallet_card_id: Number(row.wallet_card_id),
    merchant: row.merchant,
    title: row.title,
    spend_requirement_usd: row.spend_requirement_usd == null ? null : Number(row.spend_requirement_usd),
    reward_amount_usd: row.reward_amount_usd == null ? null : Number(row.reward_amount_usd),
    reward_percent: row.reward_percent == null ? null : Number(row.reward_percent),
    activated: Boolean(row.activated),
    expires_on: row.expires_on,
    status: row.status,
    source: row.source,
    note: row.note,
  };
}

export function getSetting(db, key, fallback = null) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;
}

export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, String(value));
}
