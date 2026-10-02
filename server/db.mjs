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
      membership_year_start TEXT,
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

    CREATE TABLE IF NOT EXISTS benefit_statuses (
      wallet_card_id INTEGER NOT NULL REFERENCES wallet_cards(id) ON DELETE CASCADE,
      benefit_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      activated_on TEXT,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(wallet_card_id, benefit_id)
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

  const walletColumns = new Set(db.prepare("PRAGMA table_info(wallet_cards)").all().map((column) => column.name));
  if (!walletColumns.has("membership_year_start")) {
    db.exec("ALTER TABLE wallet_cards ADD COLUMN membership_year_start TEXT");
  }
  const preferenceColumns = new Set(db.prepare("PRAGMA table_info(benefit_preferences)").all().map(column => column.name));
  if (!preferenceColumns.has("period_schedule_id")) db.exec("ALTER TABLE benefit_preferences ADD COLUMN period_schedule_id TEXT");
  const usageColumns = new Set(db.prepare("PRAGMA table_info(benefit_usage)").all().map(column => column.name));
  for (const [name, type] of [["voided_at", "TEXT"], ["value_ratio", "REAL"], ["catalog_verified_at", "TEXT"], ["redemption_method", "TEXT"]]) {
    if (!usageColumns.has(name)) db.exec(`ALTER TABLE benefit_usage ADD COLUMN ${name} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS usage_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT UNIQUE,
    wallet_card_id INTEGER NOT NULL REFERENCES wallet_cards(id),
    benefit_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    before_usd REAL NOT NULL,
    after_usd REAL NOT NULL,
    payload TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
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
      catalog_slug, nickname, last_four, opened_on, renewal_date, membership_year_start,
      annual_fee_override, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(catalog_slug, nickname) DO UPDATE SET
      last_four = excluded.last_four,
      opened_on = COALESCE(excluded.opened_on, wallet_cards.opened_on),
      renewal_date = COALESCE(excluded.renewal_date, wallet_cards.renewal_date),
      membership_year_start = COALESCE(excluded.membership_year_start, wallet_cards.membership_year_start),
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
    input.membership_year_start || null,
    input.annual_fee_override ?? null,
    input.status || "active",
  ));
}

function dateOrNull(value, field) {
  if (value == null || value === "") return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${field} must use a valid YYYY-MM-DD`);
  return String(value);
}

export function updateWalletCard(db, identifier, input) {
  const current = findWalletCard(db, identifier);
  if (!current) throw new Error("wallet card not found");
  const next = {
    nickname: input.nickname ?? current.nickname,
    last_four: Object.hasOwn(input, "last_four") ? (input.last_four || null) : current.last_four,
    opened_on: Object.hasOwn(input, "opened_on") ? dateOrNull(input.opened_on, "opened_on") : current.opened_on,
    renewal_date: Object.hasOwn(input, "renewal_date") ? dateOrNull(input.renewal_date, "renewal_date") : current.renewal_date,
    membership_year_start: Object.hasOwn(input, "membership_year_start")
      ? dateOrNull(input.membership_year_start, "membership_year_start")
      : current.membership_year_start,
    annual_fee_override: Object.hasOwn(input, "annual_fee_override")
      ? (input.annual_fee_override == null || input.annual_fee_override === "" ? null : Number(input.annual_fee_override))
      : current.annual_fee_override,
  };
  if (!next.nickname) throw new Error("nickname is required");
  if (next.annual_fee_override != null && (!Number.isFinite(next.annual_fee_override) || next.annual_fee_override < 0)) {
    throw new Error("annual_fee_override must be a non-negative number");
  }
  const row = db.prepare(`
    UPDATE wallet_cards SET
      nickname = ?, last_four = ?, opened_on = ?, renewal_date = ?,
      membership_year_start = ?, annual_fee_override = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    RETURNING *
  `).get(
    next.nickname,
    next.last_four,
    next.opened_on,
    next.renewal_date,
    next.membership_year_start,
    next.annual_fee_override,
    current.id,
  );
  return normalizeWalletCard(row);
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
    membership_year_start: row.membership_year_start,
    annual_fee_override: row.annual_fee_override == null ? null : Number(row.annual_fee_override),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listBenefitStatuses(db) {
  return db.prepare("SELECT * FROM benefit_statuses").all().map((row) => ({
    wallet_card_id: Number(row.wallet_card_id),
    benefit_id: row.benefit_id,
    status: row.status,
    activated_on: row.activated_on,
    note: row.note,
    updated_at: row.updated_at,
  }));
}

export function setBenefitStatus(db, input) {
  if (!input.wallet_card_id || !input.benefit_id) throw new Error("wallet_card_id and benefit_id are required");
  const status = input.status || "active";
  if (!["active", "inactive"].includes(status)) throw new Error("status must be active or inactive");
  const activatedOn = status === "active"
    ? dateOrNull(input.activated_on || new Date().toISOString().slice(0, 10), "activated_on")
    : null;
  const row = db.prepare(`
    INSERT INTO benefit_statuses (
      wallet_card_id, benefit_id, status, activated_on, note, updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(wallet_card_id, benefit_id) DO UPDATE SET
      status = excluded.status,
      activated_on = excluded.activated_on,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `).get(
    input.wallet_card_id,
    input.benefit_id,
    status,
    activatedOn,
    input.note || null,
  );
  return {
    wallet_card_id: Number(row.wallet_card_id),
    benefit_id: row.benefit_id,
    status: row.status,
    activated_on: row.activated_on,
    note: row.note,
    updated_at: row.updated_at,
  };
}

export function listUsage(db, { start = null, end = null, walletCardId = null } = {}) {
  const conditions = ["voided_at IS NULL"];
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
    value_ratio: row.value_ratio,
    catalog_verified_at: row.catalog_verified_at,
    redemption_method: row.redemption_method,
  }));
}

export function addUsage(db, input) {
  if (!input.wallet_card_id || !input.benefit_id) throw new Error("wallet_card_id and benefit_id are required");
  const amount = Number(input.amount_usd);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("amount_usd must be a non-negative number");
  const usedAt = input.used_at || new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    INSERT INTO benefit_usage (wallet_card_id, benefit_id, amount_usd, used_at, note, value_ratio, catalog_verified_at, redemption_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(input.wallet_card_id, input.benefit_id, amount, usedAt, input.note || null, input.value_ratio ?? null, input.catalog_verified_at ?? null, input.redemption_method || null);
  return {
    id: Number(row.id),
    wallet_card_id: Number(row.wallet_card_id),
    benefit_id: row.benefit_id,
    amount_usd: Number(row.amount_usd),
    used_at: row.used_at,
    note: row.note,
    redemption_method: row.redemption_method,
    value_ratio: row.value_ratio,
  };
}

// Serialize read/check/write so two tabs cannot overwrite or exceed the same credit.
// Corrections retire rows; the original entries and before/after totals are retained.
export function writePeriodUsage(db, input, period, { limit, replace = false } = {}) {
  const amount = Number(input.amount_usd);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("amount_usd must be a non-negative number");
  if (replace && !Number.isFinite(Number(input.expected_total_usd))) throw new Error("expected_total_usd is required for a correction");
  if (input.request_id != null && (typeof input.request_id !== "string" || input.request_id.length < 8 || input.request_id.length > 128)) throw new Error("invalid request_id");
  const payload = JSON.stringify({ card: input.wallet_card_id, benefit: input.benefit_id, period: period.key, amount, replace, date: input.used_at, note: input.note || null,
    ...(input.redemption_method ? { redemption_method: input.redemption_method } : {}),
    ...(input.revalue_existing ? { revalue_existing: true } : {}),
    ...(input.revalue_existing ? { expected_value_usd: Number(input.expected_value_usd) } : {}),
  });
  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = input.request_id && db.prepare("SELECT payload, result FROM usage_changes WHERE request_id = ?").get(input.request_id);
    if (replay) {
      if (replay.payload !== payload) throw new Error("request_id already used for a different update");
      db.exec("COMMIT");
      return JSON.parse(replay.result);
    }
    const rows = listUsage(db, { start: period.start, end: period.end, walletCardId: input.wallet_card_id }).filter(row => row.benefit_id === input.benefit_id);
    const before = Math.round(rows.reduce((sum, row) => sum + row.amount_usd, 0) * 100) / 100;
    const valueOf = entries => Math.round(entries.reduce((sum, row) => sum + row.amount_usd * (row.value_ratio ?? 0), 0) * 100) / 100;
    if (replace && Math.abs(before - Number(input.expected_total_usd)) > 0.005) throw new Error("This period changed in another session. Refresh before saving.");
    if (input.revalue_existing && Math.abs(valueOf(rows) - Number(input.expected_value_usd)) > 0.005) throw new Error("Redemption value changed in another session. Refresh before saving.");
    const after = Math.round((replace ? amount : before + amount) * 100) / 100;
    if (input.require_redemption_method && after > before && !input.redemption_method) throw new Error("Choose a redemption method for the amount used.");
    if (limit != null && after > limit + 0.005) throw new Error(`Period total cannot exceed the $${limit} credit`);
    if (replace) {
      db.prepare("UPDATE benefit_usage SET voided_at = CURRENT_TIMESTAMP WHERE wallet_card_id = ? AND benefit_id = ? AND used_at BETWEEN ? AND ? AND voided_at IS NULL").run(input.wallet_card_id, input.benefit_id, period.start, period.end);
    }
    let entry;
    if (replace) {
      // Preserve dated allocations when an anniversary window spans two years.
      // Reductions consume the most recent entries first; increases are dated
      // by the user. Correcting a total must not move old usage into this year.
      let unallocated = after;
      for (const row of rows.sort((a, b) => a.used_at.localeCompare(b.used_at) || a.id - b.id)) {
        const retained = Math.min(row.amount_usd, unallocated);
        if (retained > 0) entry = addUsage(db, { ...row, amount_usd: retained,
          ...(input.revalue_existing ? { value_ratio: input.value_ratio, catalog_verified_at: input.catalog_verified_at, redemption_method: input.redemption_method, note: input.note || row.note } : {}),
        });
        unallocated = Math.round((unallocated - retained) * 100) / 100;
      }
      if (unallocated > 0) entry = addUsage(db, { ...input, amount_usd: unallocated });
      entry = { ...input, id: entry?.id ?? null, amount_usd: after };
    } else entry = addUsage(db, { ...input, amount_usd: amount });
    const result = { ...entry, period_key: period.key, total_usd: after, before_value_usd: valueOf(rows),
      after_value_usd: valueOf(listUsage(db, { start: period.start, end: period.end, walletCardId: input.wallet_card_id }).filter(row => row.benefit_id === input.benefit_id)),
    };
    db.prepare("INSERT INTO usage_changes (request_id, wallet_card_id, benefit_id, period_key, before_usd, after_usd, payload, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(input.request_id || null, input.wallet_card_id, input.benefit_id, period.key, before, after, payload, JSON.stringify(result));
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function usageHistory(db, walletCardId, benefitId) {
  return db.prepare("SELECT id, period_key, before_usd, after_usd, created_at, result FROM usage_changes WHERE wallet_card_id = ? AND benefit_id = ? ORDER BY id DESC LIMIT 100").all(walletCardId, benefitId).map(({ result, ...row }) => {
    const saved = JSON.parse(result);
    return { ...row, before_value_usd: saved.before_value_usd ?? null, after_value_usd: saved.after_value_usd ?? null, redemption_method: saved.redemption_method || null };
  });
}

export function listPreferences(db) {
  return db.prepare("SELECT * FROM benefit_preferences").all().map((row) => ({
    wallet_card_id: Number(row.wallet_card_id),
    benefit_id: row.benefit_id,
    probability: Number(row.probability),
    personal_value_percent: Number(row.personal_value_percent),
    face_value_override: row.face_value_override == null ? null : Number(row.face_value_override),
    reminder_days: row.reminder_days == null ? null : Number(row.reminder_days),
    period_schedule_id: row.period_schedule_id || null,
  }));
}

export function setPreference(db, input) {
  const current = listPreferences(db).find(item => item.wallet_card_id === Number(input.wallet_card_id) && item.benefit_id === input.benefit_id);
  input = { ...current, ...input };
  const probability = input.probability == null ? 0.8 : Number(input.probability);
  const personal = input.personal_value_percent == null ? 1 : Number(input.personal_value_percent);
  if (!Number.isFinite(probability) || !Number.isFinite(personal) || probability < 0 || probability > 1 || personal < 0 || personal > 1) {
    throw new Error("probability and personal_value_percent must be between 0 and 1");
  }
  db.prepare(`
    INSERT INTO benefit_preferences (
      wallet_card_id, benefit_id, probability, personal_value_percent,
      face_value_override, reminder_days, period_schedule_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(wallet_card_id, benefit_id) DO UPDATE SET
      probability = excluded.probability,
      personal_value_percent = excluded.personal_value_percent,
      face_value_override = excluded.face_value_override,
      reminder_days = excluded.reminder_days,
      period_schedule_id = excluded.period_schedule_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    input.wallet_card_id,
    input.benefit_id,
    probability,
    personal,
    input.face_value_override ?? null,
    input.reminder_days ?? null,
    input.period_schedule_id || null,
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

export function updateOffer(db, id, input) {
  const current = db.prepare("SELECT * FROM offers WHERE id = ?").get(Number(id));
  if (!current) throw new Error("offer not found");
  const status = input.status ?? current.status;
  if (!["available", "used", "expired"].includes(status)) throw new Error("invalid offer status");
  if (input.activated !== undefined && typeof input.activated !== "boolean") throw new Error("activated must be boolean");
  const title = input.title ?? current.title;
  if (typeof title !== "string" || !title.trim()) throw new Error("title is required");
  const reward = input.reward_amount_usd === undefined ? current.reward_amount_usd : input.reward_amount_usd === null ? null : Number(input.reward_amount_usd);
  if (reward != null && (!Number.isFinite(reward) || reward < 0)) throw new Error("reward must be non-negative");
  const expires = input.expires_on === undefined ? current.expires_on : dateOrNull(input.expires_on, "expires_on");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("UPDATE offers SET activated = ?, status = ?, title = ?, reward_amount_usd = ?, expires_on = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *").get(input.activated == null ? current.activated : Number(input.activated), status, title.trim(), reward, expires, current.id);
    if (status === "used" && current.status !== "used") db.prepare("INSERT INTO offer_usage (offer_id, amount_usd, used_at, note) VALUES (?, ?, ?, ?)").run(current.id, reward || 0, new Date().toISOString().slice(0, 10), "Marked used; saved offer face value, not a verified statement credit");
    db.exec("COMMIT");
    return normalizeOffer(row);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
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
