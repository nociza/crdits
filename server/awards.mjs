// Hotel certificates are indivisible awards, not resettable dollar credits.
// Private issuance dates and valuation snapshots must survive catalog edits.
export function migrateAwards(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS benefit_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_card_id INTEGER NOT NULL REFERENCES wallet_cards(id),
      benefit_id TEXT NOT NULL,
      label TEXT NOT NULL,
      issued_on TEXT,
      recorded_on TEXT NOT NULL,
      expires INTEGER NOT NULL CHECK(expires IN (0,1)),
      expires_on TEXT,
      used_on TEXT,
      used_year INTEGER,
      used_year_confidence TEXT NOT NULL CHECK(used_year_confidence IN ('confirmed','estimated')),
      note TEXT,
      value_usd REAL NOT NULL CHECK(value_usd >= 0),
      value_basis TEXT NOT NULL CHECK(value_basis IN ('catalog_estimate','user_override')),
      stay_deadline TEXT NOT NULL,
      valuation_source_url TEXT NOT NULL,
      valuation_as_of TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      voided_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_live_award_identity
      ON benefit_awards(wallet_card_id, benefit_id, COALESCE(issued_on,''), label)
      WHERE voided_at IS NULL;
    CREATE TABLE IF NOT EXISTS award_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE NOT NULL,
      wallet_card_id INTEGER NOT NULL REFERENCES wallet_cards(id),
      benefit_id TEXT NOT NULL,
      before_json TEXT,
      payload TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function listAwards(db) {
  return db.prepare('SELECT * FROM benefit_awards WHERE voided_at IS NULL ORDER BY issued_on, id').all().map(row => ({ ...row }));
}

function date(value, field) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  return value;
}

export function writeAward(db, input, benefit, today) {
  const policy = benefit.certificate_policy;
  if (benefit.tracking_type !== 'award' || !policy) throw new Error('This benefit does not support free-night awards');
  if (typeof input.request_id !== 'string' || input.request_id.length < 8 || input.request_id.length > 128) throw new Error('request_id is required (8–128 characters)');
  const payload = JSON.stringify(input);
  db.exec('BEGIN IMMEDIATE');
  try {
    const replay = db.prepare('SELECT payload, result FROM award_changes WHERE request_id=?').get(input.request_id);
    if (replay) {
      if (replay.payload !== payload) throw new Error('request_id already used for a different change');
      db.exec('COMMIT');
      return JSON.parse(replay.result);
    }
    const before = input.id == null ? null : db.prepare('SELECT * FROM benefit_awards WHERE id=? AND wallet_card_id=? AND benefit_id=? AND voided_at IS NULL').get(input.id, input.wallet_card_id, benefit.id);
    if (input.id != null && !before) throw new Error('award not found for this card and benefit');
    if (before && (!Number.isInteger(input.expected_revision) || input.expected_revision !== before.revision)) throw new Error('Award changed in another session. Refresh before saving.');
    const terms = before ? { expires: Boolean(before.expires), stay_deadline: before.stay_deadline } : policy;
    const issuedInput = Object.hasOwn(input, 'issued_on') ? input.issued_on : before?.issued_on;
    const issued = issuedInput == null ? null : date(issuedInput, 'issued_on');
    const expires = input.expires_on === null ? null : input.expires_on ?? before?.expires_on ?? null;
    const used = input.used_on === null ? null : input.used_on ?? before?.used_on ?? null;
    const usedYear = used ? Number(used.slice(0, 4)) : Object.hasOwn(input, 'used_year') ? input.used_year : input.used_on === null ? null : before?.used_year ?? null;
    if (usedYear != null && (!Number.isInteger(usedYear) || usedYear < 2000 || usedYear > Number(today.slice(0, 4)) || (issued && usedYear < Number(issued.slice(0, 4))))) throw new Error('used_year must be a past or current bookkeeping year after issuance');
    if (used && input.used_year != null && input.used_year !== usedYear) throw new Error('used_year does not match the stay date');
    const confidence = used ? 'confirmed' : input.used_year_confidence ?? before?.used_year_confidence ?? 'confirmed';
    if (!['confirmed', 'estimated'].includes(confidence)) throw new Error('used_year_confidence must be confirmed or estimated');
    const note = Object.hasOwn(input, 'note') ? input.note : before?.note ?? null;
    if (note != null && (typeof note !== 'string' || note.length > 1000)) throw new Error('note must be at most 1000 characters');
    if (issued && issued > today) throw new Error('An award cannot be recorded before it is issued');
    if (!terms.expires && !issued) throw new Error('Non-expiring awards need an actual issuance date for annual accounting');
    if (terms.expires && !expires && !usedYear && !before) throw new Error('Enter the actual certificate expiration date; do not use the card anniversary');
    if (!terms.expires && expires) throw new Error('This certificate has no expiration under its catalog terms');
    if (expires && date(expires, 'expires_on') < (issued || '0000-01-01')) throw new Error('Expiration cannot precede issuance');
    if (used) {
      date(used, 'used_on');
      if (used > today || (issued && used < issued)) throw new Error('Use date must be between issuance and today');
      if (expires && (terms.stay_deadline === 'checkout_before' ? used >= expires : used > expires)) throw new Error('The stay must meet the certificate expiration deadline');
    }
    const label = input.label ?? before?.label ?? 'Annual free night';
    if (typeof label !== 'string' || !label.trim() || label.length > 120) throw new Error('Award label must be 1–120 characters');
    if (input.voided != null && typeof input.voided !== 'boolean') throw new Error('voided must be boolean');
    if (input.voided && !before) throw new Error('Only an existing award can be removed');
    // Default values are sourced once, never recomputed for an old redemption.
    const value = input.value_usd ?? before?.value_usd ?? benefit.valuation.value_usd;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) throw new Error('value_usd must be a finite nonnegative number');
    const valueBasis = input.value_usd != null && value !== (before?.value_usd ?? benefit.valuation.value_usd)
      ? 'user_override' : before?.value_basis ?? 'catalog_estimate';
    const source = before?.valuation_source_url ?? benefit.valuation.source_url;
    const valuationDate = before?.valuation_as_of ?? benefit.valuation.as_of;
    let id = before?.id;
    if (before) {
      db.prepare(`UPDATE benefit_awards SET label=?, issued_on=?, expires_on=?, used_on=?, used_year=?, used_year_confidence=?, note=?, value_usd=?, value_basis=?, revision=revision+1,
        voided_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(label.trim(), issued, expires, used, usedYear, confidence, note, value, valueBasis, input.voided ? 1 : 0, id);
    } else {
      id = Number(db.prepare(`INSERT INTO benefit_awards(wallet_card_id, benefit_id, label, issued_on, recorded_on, expires, expires_on, used_on, used_year, used_year_confidence, note, value_usd, value_basis, stay_deadline, valuation_source_url, valuation_as_of)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.wallet_card_id, benefit.id, label.trim(), issued, today, terms.expires ? 1 : 0, expires, used, usedYear, confidence, note, value, valueBasis, terms.stay_deadline, source, valuationDate).lastInsertRowid);
    }
    const result = { ...db.prepare('SELECT * FROM benefit_awards WHERE id=?').get(id) };
    db.prepare('INSERT INTO award_changes(request_id,wallet_card_id,benefit_id,before_json,payload,result) VALUES(?,?,?,?,?,?)')
      .run(input.request_id, input.wallet_card_id, benefit.id, before ? JSON.stringify(before) : null, payload, JSON.stringify(result));
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('idx_live_award_identity') || String(error.message).includes('UNIQUE constraint failed: benefit_awards')) throw new Error('This award is already recorded. Use a distinct label for an additional earned award.');
    throw error;
  }
}

export function awardState(records, asOf, preference, reportingPeriod = undefined) {
  const yearStart = reportingPeriod?.start || `${asOf.slice(0, 4)}-01-01`;
  const year = Number(asOf.slice(0, 4));
  let awards = records.filter(item => (item.issued_on || item.recorded_on) <= asOf || (item.used_year != null && item.used_year <= year)).map(item => {
    const used = item.used_on ? item.used_on <= asOf : item.used_year != null && item.used_year <= year;
    const deadline = item.expires_on;
    const expired = deadline && (item.stay_deadline === 'checkout_before' ? deadline <= asOf : deadline < asOf);
    return { ...item, used_on: used ? item.used_on : null, used_year: used ? item.used_year : null,
      status: used ? 'used' : expired ? 'expired' : item.expires && !deadline ? 'unknown_expiry' : 'available',
      days_remaining: deadline ? Math.ceil((Date.parse(deadline) - Date.parse(asOf)) / 86400000) : null };
  }).filter(item => item.status === 'available' || item.status === 'unknown_expiry' || item.used_year >= year || (item.expires_on || item.issued_on) >= yearStart);
  const counted = item => {
    if (reportingPeriod === undefined) return item.expires
      ? item.status === 'used' && item.used_year === year : item.issued_on >= yearStart;
    if (!reportingPeriod) return false;
    const end = asOf < reportingPeriod.end ? asOf : reportingPeriod.end;
    if (!item.expires) return item.issued_on >= reportingPeriod.start && item.issued_on <= end;
    if (item.status !== 'used') return false;
    if (item.used_on) return item.used_on >= reportingPeriod.start && item.used_on <= end;
    // A year-only stay may straddle renewal. Count it only when the entire
    // possible stay interval fits; never invent a date or count it twice.
    const earliest = `${item.used_year}-01-01`;
    const latest = [`${item.used_year}-12-31`, item.recorded_on, asOf].sort()[0];
    return earliest >= reportingPeriod.start && latest <= end;
  };
  awards = awards.map(item => ({ ...item, counted_in_period: counted(item),
    period_allocation_needed: Boolean(reportingPeriod && item.status === 'used' && !item.used_on && !counted(item)
      && `${item.used_year}-01-01` <= reportingPeriod.end
      && [`${item.used_year}-12-31`, item.recorded_on, asOf].sort()[0] >= reportingPeriod.start),
  }));
  const available = awards.filter(item => item.status === 'available');
  const realized = awards.filter(counted).reduce((sum, item) => sum + item.value_usd, 0);
  const remaining = available.filter(item => item.expires).reduce((sum, item) => sum + item.value_usd, 0);
  return { awards, realized, remaining, expected: remaining * preference.probability * preference.personal_value_percent };
}
