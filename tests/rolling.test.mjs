import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {addUsage, addWalletCard, openDatabase} from '../server/db.mjs';
import {buildDashboard, cardReportingPeriod} from '../server/engine.mjs';
import {awardState} from '../server/awards.mjs';
import {createService} from '../server/service.mjs';

const root = path.resolve(import.meta.dirname, '..');
const benefit = {id:'monthly', title:'Monthly credit', tracking_type:'spend', amount_usd:10, cadence:'monthly', valid_from:'2025-01-01', valuation:{value_usd:10}};
const card = {slug:'test-card', name:'Test', nickname:'Test', annual_fee_usd:95, benefits:[benefit], reward_rules:[]};

test('rolling periods follow each renewal, including leap-day anchors', () => {
  assert.deepEqual(cardReportingPeriod({membership_year_start:'2025-11-03'},'2026-11-02'),{start:'2025-11-03',end:'2026-11-02'});
  assert.deepEqual(cardReportingPeriod({membership_year_start:'2025-11-03'},'2026-11-03'),{start:'2026-11-03',end:'2027-11-02'});
  assert.deepEqual(cardReportingPeriod({opened_on:'2024-02-29'},'2026-03-01'),{start:'2026-02-28',end:'2027-02-27'});
  assert.equal(cardReportingPeriod({},'2026-10-02'),null);
});

test('portfolio sums independent active periods and never charges two fees or resets in January', () => {
  const db=openDatabase(':memory:');
  try {
    const a=addWalletCard(db,{catalog_slug:card.slug,membership_year_start:'2025-11-03'});
    const other={...card,slug:'other',annual_fee_usd:50};
    const b=addWalletCard(db,{catalog_slug:other.slug,membership_year_start:'2026-06-01'});
    for (const [wallet,used_at,amount_usd] of [[a,'2025-11-02',9],[a,'2025-12-05',10],[a,'2026-01-05',10],[b,'2026-05-31',9],[b,'2026-06-02',10]]) addUsage(db,{wallet_card_id:wallet.id,benefit_id:benefit.id,used_at,amount_usd});
    const d=buildDashboard({catalog:[card,other],db,asOf:'2026-10-02',reportingMode:'rolling'});
    assert.equal(d.metrics.realized_ytd_usd,30);
    assert.equal(d.metrics.annual_fees_usd,145);
    assert.equal(d.metrics.projected_net_usd,-115);
    assert.equal(d.cards.find(c=>c.id===a.id).upcoming_credits_usd,10); // Nov opens before Nov 3 renewal.
    assert.equal(d.cards.find(c=>c.id===b.id).upcoming_credits_usd,70);
    assert.equal(d.metrics.credits_available_now_usd,20);
    const dec=buildDashboard({catalog:[card],db,asOf:'2025-12-31',reportingMode:'rolling'});
    const jan=buildDashboard({catalog:[card],db,asOf:'2026-01-01',reportingMode:'rolling'});
    assert.deepEqual(dec.cards[0].reporting_period,jan.cards[0].reporting_period);
    assert.equal(dec.metrics.realized_ytd_usd,jan.metrics.realized_ytd_usd);
  } finally {db.close();}
});

test('default API and explicit rolling include prior-year Venture X use, not its next renewal', async () => {
  const service=createService({root,dbPath:':memory:',asOf:'2026-10-02'});
  try {
    const wallet=await service.addWalletCard({catalog_slug:'capital-one-venture-x-rewards-credit-card',membership_year_start:'2025-11-03'});
    await service.addUsage({wallet_card_id:wallet.id,benefit_id:'annual-capital-one-travel-credit',amount_usd:300,used_at:'2025-12-20'});
    const d=await service.dashboard();
    assert.equal(d.reporting_mode,'rolling');
    assert.equal(d.selected_year,null);
    assert.equal(d.metrics.realized_ytd_usd,400);
    assert.equal(d.metrics.projected_net_usd,5);
    assert.equal(d.metrics.credits_remaining_usd,0);
    assert.equal(d.metrics.upcoming_credits_usd,0);
    assert.deepEqual(await service.dashboard({year:'rolling'}),d);
    assert.equal((await service.dashboard({year:2026})).metrics.realized_ytd_usd,100);
    await assert.rejects(service.dashboard({year:'bad'}),/year must/);
  } finally {service.db.close();}
});

test('monthly, quarterly and semiannual timelines cross years without changing issuer windows', () => {
  const db=openDatabase(':memory:');
  try {
    const split={...card,benefits:[benefit,{...benefit,id:'quarter',cadence:'quarterly'},{...benefit,id:'half',cadence:'semiannual'}]};
    addWalletCard(db,{catalog_slug:card.slug,membership_year_start:'2025-11-03'});
    const d=buildDashboard({catalog:[split],db,asOf:'2026-10-02',reportingMode:'rolling'});
    const monthly=d.cards[0].benefits.find(b=>b.id==='monthly').periods;
    assert.equal(monthly[0].label,'Nov 2025');
    assert.equal(monthly.at(-1).label,'Nov 2026');
    assert.equal(monthly.find(p=>p.is_current).key,'2026-10');
    const quarter=d.cards[0].benefits.find(b=>b.id==='quarter').periods;
    assert.equal(quarter[0].start,'2025-10-01');
    assert.equal(quarter.at(-1).end,'2026-12-31');
    const half=d.cards[0].benefits.find(b=>b.id==='half').periods;
    assert.equal(half[0].start,'2025-07-01');
    assert.equal(half.at(-1).end,'2026-12-31');
  } finally {db.close();}
});

test('missing anchors keep availability but do not invent period net or deduct an unaligned fee', () => {
  const db=openDatabase(':memory:');
  try {
    const wallet=addWalletCard(db,{catalog_slug:card.slug});
    addUsage(db,{wallet_card_id:wallet.id,benefit_id:benefit.id,amount_usd:5,used_at:'2026-10-01'});
    const d=buildDashboard({catalog:[card],db,asOf:'2026-10-02',reportingMode:'rolling'});
    assert.equal(d.cards[0].reporting_period,null);
    assert.equal(d.cards[0].projected_net_usd,null);
    assert.equal(d.metrics.realized_ytd_usd,0);
    assert.equal(d.metrics.annual_fees_usd,0);
    assert.equal(d.metrics.credits_available_now_usd,5);
    assert.equal(d.period_date_needed_count,1);
  } finally {db.close();}
});

test('used nights are allocated by actual stay, and ambiguous year-only stays never count twice', () => {
  const preference={probability:1,personal_value_percent:1};
  const award={id:1,expires:1,value_usd:240,used_on:'2025-12-20',used_year:2025,recorded_on:'2026-10-02',expires_on:'2026-12-31',stay_deadline:'checkout_by'};
  const range={start:'2025-11-03',end:'2026-11-02'};
  assert.equal(awardState([award],'2026-10-02',preference,range).realized,240);
  const ambiguous={...award,used_on:null,used_year:2026};
  assert.equal(awardState([ambiguous],'2026-10-02',preference,range).realized,240);
  const renewed=awardState([ambiguous],'2026-11-03',preference,{start:'2026-11-03',end:'2027-11-02'});
  assert.equal(renewed.realized,0);
  assert.equal(renewed.awards[0].period_allocation_needed,false); // recorded before renewal: definitely prior period.
  const may=awardState([ambiguous],'2026-10-02',preference,{start:'2026-05-15',end:'2027-05-14'});
  assert.equal(may.realized,0);
  assert.equal(may.awards[0].period_allocation_needed,true);
});
