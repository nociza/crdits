import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import { createService } from '../server/service.mjs';
import { loadCatalog, upsertBenefit, validateCard } from '../server/catalog.mjs';
import { addUsage, addWalletCard, openDatabase, setPreference } from '../server/db.mjs';
import { buildDashboard } from '../server/engine.mjs';
import { writeAward } from '../server/awards.mjs';
import { createApiClient } from '../integrations/client.mjs';
import { cardCreditState, creditActions } from '../app/ui/credit-state.ts';

const root = path.resolve(import.meta.dirname, '..');
const hotelCards = [
  ['world-of-hyatt-credit-card', 240, 'checkout_before'],
  ['marriott-bonvoy-boundless-credit-card', 192, 'checkin_by'],
  ['hilton-honors-american-express-aspire-card', 521, 'checkout_by'],
];

for (const [slug, estimate, deadline] of hotelCards) {
  test(`${slug}: sourced award estimate, private issuance, actual stay, and undo`, async () => {
    const service = createService({ root, dbPath: ':memory:', asOf: '2026-10-02' });
    try {
      const wallet = await service.addWalletCard({ catalog_slug: slug, membership_year_start: '2026-04-15' });
      const benefit = (await service.catalogCard(slug)).benefits.find(item => item.tracking_type === 'award');
      assert.equal(benefit.valuation.value_usd, estimate);
      assert.equal(benefit.valuation.method, 'market_estimate');
      assert.equal(benefit.certificate_policy.expiry_months, 12);
      assert.equal(benefit.certificate_policy.stay_deadline, deadline);
      const empty = await service.dashboard();
      assert.equal(empty.cards[0].award_realized_ytd_usd, 0);
      assert.equal(empty.cards[0].benefits.find(item => item.id === benefit.id).expires_on, null);
      assert.equal(cardCreditState(empty.cards[0]).visible, true);
      const input = { wallet_card_id: wallet.id, benefit_id: benefit.id, issued_on: '2026-05-19', expires_on: '2027-05-19', request_id: `issue-${slug}` };
      const award = await service.saveAward(input);
      assert.deepEqual(await service.saveAward(input), award);
      assert.equal(award.value_usd, estimate);
      const held = await service.dashboard();
      const state = held.cards[0].benefits.find(item => item.id === benefit.id);
      assert.equal(state.expires_on, '2027-05-19');
      assert.equal(state.used_value_usd, 0);
      assert.equal(held.cards[0].award_realized_ytd_usd, 0);
      assert.equal(state.expected_value_usd, estimate);
      assert.equal(held.cards[0].remaining_usd, empty.cards[0].remaining_usd);
      assert.equal(held.cards[0].expected_remaining_usd, empty.cards[0].expected_remaining_usd);
      for (const field of ['credits_remaining_usd', 'credits_available_now_usd', 'expected_remaining_usd']) assert.equal(held.metrics[field], empty.metrics[field]);
      assert.equal(held.cards[0].projected_net_usd, empty.cards[0].projected_net_usd);
      const redeemed = await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, id: award.id, expected_revision: award.revision, used_on: '2026-07-10', request_id: `redeem-${slug}` });
      const used = await service.dashboard();
      assert.equal(used.cards[0].award_realized_ytd_usd, estimate);
      assert.equal(used.cards[0].projected_net_usd, empty.cards[0].projected_net_usd + estimate);
      assert.equal(used.cards[0].benefits.find(item => item.id === benefit.id).remaining_usd, 0);
      const undo = await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, id: award.id, expected_revision: redeemed.revision, used_on: null, request_id: `undo-${slug}` });
      assert.equal((await service.dashboard()).cards[0].award_realized_ytd_usd, 0);
      await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, id: award.id, expected_revision: undo.revision, voided: true, request_id: `remove-${slug}` });
      assert.equal(service.db.prepare('SELECT count(*) AS n FROM benefit_awards').get().n, 1);
      assert.equal(service.db.prepare('SELECT count(*) AS n FROM award_changes').get().n, 4);
      assert.equal(service.db.prepare('SELECT count(*) AS n FROM benefit_usage').get().n, 0);
      assert.equal((await service.dashboard()).cards[0].award_realized_ytd_usd, 0);
    } finally { service.db.close(); }
  });
}

test('CLEAR, entry and Priority Pass never enter net, including previously pinned ledger ratios', async () => {
  const catalog = await loadCatalog(path.join(root, 'catalog/cards'));
  const db = openDatabase(':memory:');
  try {
    let expectedFees = 0;
    for (const slug of ['hilton-honors-american-express-aspire-card', 'capital-one-venture-x-rewards-credit-card', 'chase-sapphire-preferred', 'bilt-palladium-card']) {
      const card = catalog.find(item => item.slug === slug);
      const wallet = addWalletCard(db, { catalog_slug: slug, membership_year_start: '2026-01-01' });
      expectedFees += card.annual_fee_usd;
      for (const benefit of card.benefits.filter(item => item.net_value_policy === 'excluded')) {
        const row = addUsage(db, { wallet_card_id: wallet.id, benefit_id: benefit.id, amount_usd: benefit.amount_usd || 399, used_at: '2026-02-01' });
        db.prepare('UPDATE benefit_usage SET value_ratio=1 WHERE id=?').run(row.id);
      }
    }
    const before = db.prepare('SELECT * FROM benefit_usage ORDER BY id').all();
    const dashboard = buildDashboard({ catalog, db, asOf: '2026-10-02' });
    assert.equal(dashboard.metrics.realized_ytd_usd, 100); // Venture X miles only
    assert.equal(dashboard.metrics.projected_net_usd, 100 - expectedFees);
    for (const card of dashboard.cards) for (const benefit of card.benefits.filter(item => /clear|global.entry|priority.pass/i.test(item.id))) {
      assert.equal(benefit.counts_toward_value, false);
      assert.equal(benefit.used_value_usd, 0);
      assert.ok(!benefit.expected_value_usd);
    }
    assert.deepEqual(db.prepare('SELECT * FROM benefit_usage ORDER BY id').all(), before);
  } finally { db.close(); }
});

test('entry perks are absent from all remaining and potential totals while face balances and history survive', async () => {
  const catalog = await loadCatalog(path.join(root, 'catalog/cards'));
  const db = openDatabase(':memory:');
  try {
    for (const slug of ['hilton-honors-american-express-aspire-card', 'capital-one-venture-x-rewards-credit-card', 'chase-sapphire-preferred', 'bilt-palladium-card']) {
      const definition = catalog.find(card => card.slug === slug);
      const wallet = addWalletCard(db, { catalog_slug: slug, membership_year_start: '2026-01-01' });
      for (const benefit of definition.benefits.filter(item => item.net_value_policy === 'excluded')) {
        setPreference(db, {wallet_card_id: wallet.id, benefit_id: benefit.id, probability: 1, personal_value_percent: 1, face_value_override: 500});
        const row = addUsage(db, {wallet_card_id: wallet.id, benefit_id: benefit.id, amount_usd: 25, used_at: '2026-02-01'});
        db.prepare('UPDATE benefit_usage SET value_ratio=1 WHERE id=?').run(row.id);
      }
    }
    const rows = db.prepare('SELECT * FROM benefit_usage ORDER BY id').all();
    const withoutPerks = catalog.map(card => ({...card, benefits: card.benefits.filter(benefit => benefit.net_value_policy !== 'excluded')}));
    for (const asOf of ['2026-02-02', '2026-10-02', '2026-12-31']) {
      const dashboard = buildDashboard({catalog, db, asOf});
      const control = buildDashboard({catalog: withoutPerks, db, asOf});
      for (const field of ['credits_remaining_usd', 'credits_available_now_usd', 'expected_remaining_usd']) assert.equal(dashboard.metrics[field], control.metrics[field], field);
      for (const card of dashboard.cards) {
        const reference = control.cards.find(item => item.id === card.id);
        assert.equal(card.remaining_usd, reference.remaining_usd);
        assert.equal(card.expected_remaining_usd, reference.expected_remaining_usd);
        for (const benefit of card.benefits.filter(item => item.counts_toward_value === false && item.tracking_type === 'spend')) {
          assert.equal(benefit.remaining_usd, 500 - benefit.used_usd);
          assert.ok(!benefit.expected_value_usd);
        }
      }
    }
    assert.deepEqual(db.prepare('SELECT * FROM benefit_usage ORDER BY id').all(), rows);
  } finally { db.close(); }
});

test('award writes fail closed on invalid dates, mismatched ownership, stale edits and conflicting retries', async () => {
  const service = createService({ root, dbPath: ':memory:', asOf: '2026-10-02' });
  try {
    const wallet = await service.addWalletCard({ catalog_slug: 'world-of-hyatt-credit-card' });
    const other = await service.addWalletCard({ catalog_slug: 'world-of-hyatt-credit-card', nickname: 'Second wallet' });
    const benefit = (await service.catalogCard(wallet.catalog_slug)).benefits.find(item => item.tracking_type === 'award');
    const base = { wallet_card_id: wallet.id, benefit_id: benefit.id, issued_on: '2026-02-03', expires_on: '2027-02-03', request_id: 'award-first-record' };
    const saved = await service.saveAward(base);
    await assert.rejects(service.saveAward({ ...base, label: 'Different' }), /request_id/);
    for (const changes of [{ issued_on: '2026-02-30' }, { issued_on: '2026-10-03' }, { expires_on: null }, { expires_on: '2025-02-03' }, { used_on: '2027-02-03' }, { used_on: '2026-02-02' }, { value_usd: -1 }, { value_usd: '10' }, { label: '' }, { voided: true }]) {
      await assert.rejects(service.saveAward({ ...base, ...changes, request_id: `invalid-award-${JSON.stringify(changes)}` }));
    }
    await assert.rejects(service.saveAward({ ...base, request_id: 'duplicate-second-key' }), /already recorded/);
    await assert.rejects(service.saveAward({ wallet_card_id: other.id, benefit_id: benefit.id, id: saved.id, expected_revision: 1, request_id: 'wrong-ownership' }), /not found/);
    await assert.rejects(service.saveAward({ ...base, id: saved.id, expected_revision: 0, request_id: 'stale-award-edit' }), /another session/);
    await assert.rejects(service.saveAward({ ...base, id: saved.id, request_id: 'missing-revision' }), /another session/);
    await assert.rejects(service.addUsage({ wallet_card_id: wallet.id, benefit_id: benefit.id, amount_usd: 240, used_at: '2026-02-04' }), /does not use the spend ledger/);
    assert.equal(service.db.prepare('SELECT count(*) AS n FROM benefit_awards').get().n, 1);
    assert.equal(service.db.prepare('SELECT count(*) AS n FROM award_changes').get().n, 1);
    assert.equal((await service.dashboard()).cards.find(item => item.id === wallet.id).award_realized_ytd_usd, 0);
  } finally { service.db.close(); }
});

test('expired awards are zero until a retrospective actual stay is recorded; years do not double-count', async () => {
  const service = createService({ root, dbPath: ':memory:', asOf: '2026-10-02' });
  try {
    const wallet = await service.addWalletCard({ catalog_slug: 'world-of-hyatt-credit-card' });
    const benefit = (await service.catalogCard(wallet.catalog_slug)).benefits.find(item => item.tracking_type === 'award');
    const award = await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, issued_on: '2025-03-04', expires_on: '2026-03-04', request_id: 'past-issued-example' });
    assert.equal((await service.dashboard()).cards[0].benefits.find(item => item.id === benefit.id).awards[0].status, 'expired');
    assert.equal((await service.dashboard()).cards[0].award_realized_ytd_usd, 0);
    await assert.rejects(service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, id: award.id, expected_revision: 1, used_on: '2026-03-04', request_id: 'hyatt-expiration-day' }), /expiration deadline/);
    await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, id: award.id, expected_revision: 1, used_on: '2025-11-12', request_id: 'past-actual-stay' });
    assert.equal((await service.dashboard()).cards[0].award_realized_ytd_usd, 0);
    assert.equal((await service.dashboard({ year: 2025 })).cards[0].award_realized_ytd_usd, 240);
    assert.equal((await service.reminders()).reminders.filter(item => item.type === 'award').length, 0);
  } finally { service.db.close(); }
});

test('award reminders use real expiry, and cancelled use preserves history', async () => {
  const service = createService({ root, dbPath: ':memory:', asOf: '2026-10-02' });
  try {
    const wallet = await service.addWalletCard({ catalog_slug: 'marriott-bonvoy-boundless-credit-card' });
    const benefit = (await service.catalogCard(wallet.catalog_slug)).benefits.find(item => item.tracking_type === 'award');
    const award = await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, issued_on: '2025-10-09', expires_on: '2026-10-09', request_id: 'reminder-award-example' });
    const reminder = (await service.reminders()).reminders.find(item => item.type === 'award');
    assert.equal(reminder.expires_on, '2026-10-09');
    assert.equal(reminder.award_id, award.id);
    assert.equal(cardCreditState((await service.dashboard()).cards[0]).warning, true);
    const used = await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, id: award.id, expected_revision: 1, used_on: '2026-10-02', value_usd: 155, request_id: 'actual-value-award' });
    assert.equal((await service.reminders()).reminders.filter(item => item.type === 'award').length, 0);
    assert.equal((await service.dashboard()).cards[0].award_realized_ytd_usd, 155);
    await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, id: award.id, expected_revision: used.revision, used_on: null, request_id: 'cancel-actual-award' });
    assert.equal((await service.dashboard()).cards[0].award_realized_ytd_usd, 0);
    assert.equal((await service.reminders()).reminders.filter(item => item.type === 'award').length, 1);
    const audit = service.db.prepare('SELECT before_json FROM award_changes ORDER BY id DESC LIMIT 1').get();
    assert.equal(JSON.parse(audit.before_json).used_on, '2026-10-02');
  } finally { service.db.close(); }
});

test('non-expiring certificates count on actual issuance once, not at redemption or in later years', () => {
  const db = openDatabase(':memory:');
  try {
    const benefit = { id: 'nonexpiring-example', title: 'Example', kind: 'certificate', tracking_type: 'award', cadence: 'anniversary', amount_usd: null,
      source_url: 'https://example.com/terms', certificate_policy: { expires: false, expiry_months: null, stay_deadline: 'checkout_by', rule: 'Synthetic test certificate does not expire', source_url: 'https://example.com/terms' },
      valuation: { method: 'market_estimate', value_usd: 200, basis: 'Synthetic test', source_url: 'https://example.com/value', as_of: '2026-01-01' } };
    const card = { slug: 'example', name: 'Example card', annual_fee_usd: 95, benefits: [benefit], reward_rules: [], sources: [] };
    const wallet = addWalletCard(db, { catalog_slug: card.slug });
    assert.equal(buildDashboard({ catalog: [card], db, asOf: '2026-10-02' }).cards[0].realized_ytd_usd, 0);
    const award = writeAward(db, { wallet_card_id: wallet.id, issued_on: '2026-03-04', request_id: 'nonexpire-issued-example' }, benefit, '2026-10-02');
    assert.equal(buildDashboard({ catalog: [card], db, asOf: '2026-10-02' }).cards[0].realized_ytd_usd, 200);
    writeAward(db, { wallet_card_id: wallet.id, id: award.id, expected_revision: 1, used_on: '2026-07-08', request_id: 'nonexpire-used-example' }, benefit, '2026-10-02');
    assert.equal(buildDashboard({ catalog: [card], db, asOf: '2026-10-02' }).cards[0].realized_ytd_usd, 200);
    assert.equal(buildDashboard({ catalog: [card], db, asOf: '2027-10-02' }).cards[0].realized_ytd_usd, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM benefit_usage').get().n, 0);
  } finally { db.close(); }
});

test('community edits preserve certificate terms and do not reprice saved awards', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'crdits-awards-catalog-'));
  await cp(path.join(root, 'catalog/cards'), directory, { recursive: true });
  const service = createService({ root, catalogDir: directory, dbPath: ':memory:', asOf: '2026-10-02' });
  try {
    const wallet = await service.addWalletCard({ catalog_slug: 'world-of-hyatt-credit-card' });
    const card = await service.catalogCard(wallet.catalog_slug);
    const benefit = card.benefits.find(item => item.tracking_type === 'award');
    const award = await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, issued_on: '2026-01-05', expires_on: '2027-01-05', request_id: 'before-catalog-change' });
    await upsertBenefit(directory, card.slug, { id: benefit.id, title: 'Updated description', valuation_value_usd: 260 });
    const updated = await service.catalogCard(card.slug);
    assert.deepEqual(updated.benefits.find(item => item.id === benefit.id).certificate_policy, benefit.certificate_policy);
    const used = await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefit.id, id: award.id, expected_revision: 1, used_on: '2026-07-08', request_id: 'after-catalog-change' });
    assert.equal(used.value_usd, 240);
    assert.equal((await service.dashboard()).cards[0].award_realized_ytd_usd, 240);
    const malformed = structuredClone(updated);
    malformed.benefits.find(item => item.id === benefit.id).certificate_policy.expires = 'no';
    assert.match(validateCard(malformed).join(' '), /certificate terms/);
    await assert.rejects(upsertBenefit(directory, card.slug, { id: benefit.id, tracking_type: 'spend' }), /certificate_policy/);
  } finally { service.db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('hotel certificates promote otherwise quiet cards without a false warning or dollar-use button', () => {
  const benefit = { tracking_type: 'award', remaining_usd: 0, used_usd: 0, requires_membership_year: false, periods: [], awards: [] };
  assert.equal(cardCreditState({ benefits: [benefit] }).visible, true);
  assert.equal(cardCreditState({ benefits: [benefit] }).label, 'Free night to track');
  assert.equal(cardCreditState({ benefits: [benefit] }).warning, false);
  assert.deepEqual(creditActions(benefit), { log: false, edit: false, setDate: false });
  assert.equal(cardCreditState({ benefits: [{ ...benefit, awards: [{ status: 'used' }] }] }).visible, false);
  assert.equal(cardCreditState({ benefits: [{ ...benefit, awards: [{ status: 'available' }] }] }).label, '1 free night available');
});

test('remote award mutations use the existing bounded authenticated client', async () => {
  let call;
  const client = createApiClient({ baseUrl: 'https://example.test/private/', token: 'test-token', fetchImpl: async (url, options) => {
    call = { url: String(url), options }; return Response.json({ id: 2, revision: 1 });
  } });
  const input = { wallet_card_id: 1, benefit_id: 'example', issued_on: '2026-01-01', expires_on: '2027-01-01', request_id: 'client-award-example' };
  await client.saveAward(input);
  assert.equal(call.url, 'https://example.test/private/v1/awards');
  assert.equal(call.options.headers.authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(call.options.body), input);
});

test('known expiry with unknown issuance is tracked without inventing a historical issue date', async () => {
  const service = createService({ root, dbPath: ':memory:', asOf: '2026-10-02' });
  try {
    const wallet = await service.addWalletCard({ catalog_slug: 'marriott-bonvoy-boundless-credit-card' });
    const benefitId = 'earned-50k-free-night-awards';
    for (let index = 0; index < 3; index++) await service.saveAward({ wallet_card_id: wallet.id, benefit_id: benefitId, label: `Bonus night ${index + 1}`, expires_on: '2027-07-08', request_id: `synthetic-promo-${index}` });
    const current = (await service.dashboard()).cards[0];
    const benefit = current.benefits.find(item => item.id === benefitId);
    assert.equal(benefit.annual_award, false);
    assert.equal(benefit.awards.length, 3);
    assert.equal(benefit.awards[0].issued_on, null);
    assert.equal(benefit.awards[0].recorded_on, '2026-10-02');
    assert.equal(benefit.remaining_usd, 822);
    assert.equal(current.award_realized_ytd_usd, 0);
    assert.equal((await service.dashboard({ year: 2025 })).cards[0].benefits.find(item => item.id === benefitId).awards.length, 0);
    assert.equal(service.db.prepare('SELECT count(*) AS n FROM benefit_usage').get().n, 0);
  } finally { service.db.close(); }
});

test('the next hotel anniversary is a calendar marker, never an invented issued award or expiry', async () => {
  const service = createService({ root, dbPath: ':memory:', asOf: '2026-10-02' });
  try {
    await service.addWalletCard({ catalog_slug: 'world-of-hyatt-credit-card', membership_year_start: '2025-10-22' });
    const benefit = (await service.dashboard()).cards[0].benefits.find(item => item.tracking_type === 'award');
    assert.equal(benefit.next_anniversary_on, '2026-10-22');
    assert.equal(benefit.expires_on, null);
    assert.equal(benefit.awards.length, 0);
    assert.equal(benefit.used_value_usd, 0);
  } finally { service.db.close(); }
});

test('year-only completed stays preserve unknown dates and tentative year allocation without automatic expiry value', async () => {
  const service = createService({ root, dbPath: ':memory:', asOf: '2026-10-02' });
  try {
    const wallet = await service.addWalletCard({ catalog_slug: 'world-of-hyatt-credit-card' });
    const benefit = (await service.catalogCard(wallet.catalog_slug)).benefits.find(item => item.tracking_type === 'award');
    const base = { wallet_card_id: wallet.id, benefit_id: benefit.id };
    const award = await service.saveAward({ ...base, used_year: 2025, used_year_confidence: 'estimated', note: 'Owner reports a completed stay but only an approximate year.', request_id: 'year-only-stay-example' });
    assert.equal(award.issued_on, null);
    assert.equal(award.expires_on, null);
    assert.equal(award.used_on, null);
    assert.equal(award.expires, 1);
    assert.equal(award.used_year_confidence, 'estimated');
    assert.equal((await service.dashboard()).cards[0].award_realized_ytd_usd, 0);
    const historical = await service.dashboard({ year: 2025 });
    assert.equal(historical.cards[0].award_realized_ytd_usd, 240);
    assert.equal(historical.cards[0].benefits.find(item => item.id === benefit.id).awards[0].status, 'used');
    await assert.rejects(service.saveAward({ ...base, used_year: 2027, request_id: 'invalid-future-year' }), /bookkeeping year/);
    await assert.rejects(service.saveAward({ ...base, used_year: 2025, used_year_confidence: 'maybe', request_id: 'invalid-year-confidence' }), /confidence/);
    await assert.rejects(service.saveAward({ ...base, used_year: 2025, used_on: '2026-02-03', request_id: 'mismatched-date-year' }), /does not match/);
    const cleared = await service.saveAward({ ...base, id: award.id, expected_revision: 1, used_year: null, used_on: null, request_id: 'clear-year-only-example' });
    assert.equal(cleared.used_year, null);
    assert.equal((await service.dashboard({ year: 2025 })).cards[0].award_realized_ytd_usd, 0);
    const current = (await service.dashboard()).cards[0];
    assert.equal(current.award_realized_ytd_usd, 0);
    assert.equal(current.benefits.find(item => item.id === benefit.id).awards[0].status, 'unknown_expiry');
    assert.equal(current.benefits.find(item => item.id === benefit.id).remaining_usd, 0);
    assert.equal(cardCreditState(current).label, 'Free-night expiry date needed');
    assert.equal(JSON.parse(service.db.prepare('SELECT before_json FROM award_changes ORDER BY id DESC LIMIT 1').get().before_json).used_year, 2025);
  } finally { service.db.close(); }
});
