"use client";

import { CatalogEditor } from "./CatalogEditor";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Benefit = {
  id: string;
  title: string;
  kind: string;
  cadence: string;
  description: string | null;
  tracking_type: "spend" | "automatic" | "enrollment" | "reference";
  amount_usd: number | null;
  points_amount: number | null;
  used_usd: number;
  remaining_usd: number | null;
  expected_value_usd: number | null;
  catalog_value_usd: number | null;
  valuation_method: "face_value" | "points" | "market_estimate" | "excluded" | null;
  valuation_basis: string | null;
  valuation_source_url: string | null;
  valuation_as_of: string | null;
  probability: number;
  personal_value_percent: number;
  expires_on: string | null;
  days_remaining: number | null;
  status: string | null;
  activated_on: string | null;
  requires_membership_year: boolean;
  counts_toward_value: boolean;
  periods: BenefitPeriod[];
  is_actionable: boolean;
};

type BenefitPeriod = {
  key: string;
  label: string;
  start: string;
  end: string;
  amount_usd: number;
  used_usd: number;
  remaining_usd: number;
  status: "used" | "partial" | "expired" | "upcoming" | "available";
  is_current: boolean;
};

type WalletCard = {
  id: number;
  catalog_slug: string;
  nickname: string;
  last_four: string | null;
  membership_year_start: string | null;
  name: string;
  short_name: string;
  issuer: string;
  image_url: string | null;
  image_alt: string;
  annual_fee_usd: number;
  verification_status: string;
  reward_currency: { name: string | null; point_value_cents: number | null };
  realized_ytd_usd: number;
  remaining_usd: number;
  expected_remaining_usd: number;
  projected_net_usd: number;
  actionable_benefits_count: number;
  needs_attention: boolean;
  next_action_date: string | null;
  benefits: Benefit[];
};

type CatalogCard = {
  slug: string;
  name: string;
  short_name: string;
  issuer: string;
  image_url: string | null;
  image_alt: string;
  annual_fee_usd: number | null;
  point_value_cents: number | null;
  verification_status: string;
  verified_at: string | null;
  benefits_count: number;
  reward_rules_count: number;
};

type Reminder = {
  benefit_id?: string;
  type: string;
  severity: "urgent" | "upcoming";
  wallet_card_id: number;
  card_name: string;
  title: string;
  detail: string;
  expires_on: string;
};

type Offer = {
  id: number;
  wallet_card_id: number;
  merchant: string;
  title: string;
  reward_amount_usd: number | null;
  activated: boolean;
  expires_on: string | null;
};

type Dashboard = {
  as_of: string;
  metrics: {
    realized_ytd_usd: number;
    credits_remaining_usd: number;
    expected_remaining_usd: number;
    targeted_offers_usd: number;
    annual_fees_usd: number;
    projected_net_usd: number;
  };
  cards: WalletCard[];
  reminders: Reminder[];
  offers: Offer[];
  offer_history?: (Offer & { status: string })[];
  catalog_cards: CatalogCard[];
};

type Recommendation = {
  category: string;
  merchant: string;
  amount_usd: number;
  recommendation: Array<{
    wallet_card_id: number;
    nickname: string;
    last_four: string | null;
    rule: string;
    total_value_usd: number;
    reward_value_usd: number;
    offer_value_usd: number;
    conditional_alternatives?: { rule_id: string; rule: string; reason: string }[];
  }>;
};

type BenefitEditor = { mode: "usage"; card: WalletCard; benefit: Benefit; periodKey: string | null };

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const RESET_CADENCE_DETAILS: Record<string, string> = {
  monthly: "Resets every month",
  quarterly: "Resets every quarter",
  semiannual: "Resets every six months",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/crdits${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: number; detail: string; tone?: "neutral" | "good" | "warn" }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value < 0 ? `−${usd.format(Math.abs(value))}` : usd.format(value)}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Progress({ used, total }: { used: number; total: number | null }) {
  const percent = total && total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : 0;
  return <span className="progress-track" aria-label={`${Math.round(percent)} percent used`}><i style={{ width: `${percent}%` }} /></span>;
}

function CreditPeriods({ cadence, periods, asOf, onSelect }: { cadence: string; periods: BenefitPeriod[]; asOf: string; onSelect: (period: BenefitPeriod) => void }) {
  return (
    <div className={`credit-periods has-${periods.length} is-${cadence}`} aria-label="Credit periods">
      {periods.map((period) => {
        const selectable = period.start <= asOf;
        const detail = period.status === "used"
          ? `${usd.format(period.amount_usd)} used`
          : period.status === "partial"
            ? period.is_current ? `${usd.format(period.remaining_usd)} left` : `${usd.format(period.used_usd)} used`
            : period.status === "expired"
              ? "Ended"
              : period.status === "upcoming"
                ? `${usd.format(period.amount_usd)} next`
                : `${usd.format(period.remaining_usd)} left`;
        return (
          <button type="button" className={`credit-period is-${period.status} ${period.is_current ? "is-current" : ""}`} key={period.key} aria-current={period.is_current ? "true" : undefined} disabled={!selectable} onClick={() => onSelect(period)} title={selectable ? `Set ${period.label} used total` : period.status === "upcoming" ? `Upcoming period: ${period.start} through ${period.end}` : `${period.label} is fully used`}>
            <small>{period.label}</small><strong>{detail}</strong><i>{period.is_current ? "Current" : period.status}</i>
          </button>
        );
      })}
    </div>
  );
}

function UsageModal({ card, benefit, asOf, periodKey, onSubmit, onCancel }: {
  card: WalletCard;
  benefit: Benefit;
  asOf: string;
  periodKey: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancel: () => void;
}) {
  const selectedPeriod = benefit.periods.find((period) => period.key === periodKey);
  const usedAt = selectedPeriod && !selectedPeriod.is_current ? selectedPeriod.end : asOf;
  const previousTotal = selectedPeriod?.used_usd ?? benefit.used_usd;
  const defaultAmount = previousTotal || selectedPeriod?.amount_usd || benefit.amount_usd || 0;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submitting = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [history, setHistory] = useState<{ id: number; period_key: string; before_usd: number; after_usd: number; created_at: string }[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const amountInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    amountInput.current?.focus();
    amountInput.current?.select();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let active = true;
    api<typeof history>(`/v1/usage/history?card=${card.id}&benefit=${encodeURIComponent(benefit.id)}`)
      .then(value => { if (active) setHistory(value); })
      .catch(() => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, [card.id, benefit.id]);

  return (
    <dialog ref={dialogRef} className="usage-modal-backdrop" onCancel={onCancel}>
      <section className="usage-modal" role="dialog" aria-modal="true" aria-labelledby="usage-modal-title">
        <header><div><span>{card.nickname}</span><h3 id="usage-modal-title">{selectedPeriod ? `Set ${selectedPeriod.label} total` : "Set credit total"}</h3></div><button type="button" aria-label="Close" onClick={onCancel}>×</button></header>
        <p>{benefit.title}</p>
        {selectedPeriod ? <small>{selectedPeriod.start} – {selectedPeriod.end} · {usd.format(selectedPeriod.remaining_usd)} left</small> : null}
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setSaving(true);
          try { setSaveError(null); await onSubmit(event); } catch (error) { setSaveError(error instanceof Error ? error.message : "Save failed"); } finally { submitting.current = false; setSaving(false); }
        }}>
          <input name="period_key" type="hidden" value={selectedPeriod?.key || ""} />
          <input name="used_at" type="hidden" value={usedAt} />
          <input name="expected_total_usd" type="hidden" value={previousTotal} />
          <input name="request_id" type="hidden" value={requestId} />
          <label>Total used this period<span><b>$</b><input ref={amountInput} name="amount_usd" type="number" step="0.01" min="0" max={selectedPeriod?.amount_usd ?? benefit.amount_usd ?? undefined} defaultValue={defaultAmount} required /></span></label>
          {benefit.requires_membership_year ? <label>Current membership year started<input name="membership_year_start" type="date" max={asOf} required /><small>Save this once to track the annual credit and its expiry.</small></label> : null}
          <div><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button disabled={saving || !requestId}>{saving ? "Saving…" : "Save total"}</button></div>
        </form>
        {saveError && <p role="alert">{saveError}</p>}
        <details><summary>Correction history</summary>
          {historyError ? <p role="status">History unavailable. Close and reopen to retry.</p> : history === null ? <p>Loading…</p> : history.length ? <ul>{history.map(item => <li key={item.id}>{item.period_key}: {usd.format(item.before_usd)} → {usd.format(item.after_usd)} · {item.created_at} UTC</li>)}</ul> : <p>No corrections yet. Earlier ledger entries are retained.</p>}
          <p>Enter 0 to clear a mistaken total. Corrections remain in your private audit trail.</p>
        </details>
      </section>
    </dialog>
  );
}

function CardArtwork({ card, compact = false }: { card: Pick<WalletCard, "name" | "issuer" | "image_url" | "image_alt">; compact?: boolean }) {
  return (
    <span className={`card-art ${compact ? "compact" : ""}`}>
      {card.image_url ? <img src={card.image_url} alt={card.image_alt} loading="lazy" referrerPolicy="no-referrer" /> : <b>{card.issuer.slice(0, 1)}</b>}
    </span>
  );
}

export function CrditsDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const latestRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "wallet" | "catalog">("overview");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendBusy, setRecommendBusy] = useState(false);
  const [edit, setEdit] = useState<BenefitEditor | null>(null);
  const [cardEdit, setCardEdit] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const data = await api<Dashboard>(`/v1/dashboard?year=${year}`);
      if (request !== latestRequest.current) return;
      setDashboard(data);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load crdits");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const urgent = dashboard?.reminders.filter((item) => item.severity === "urgent") ?? [];
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void reload(); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [reload]);

  function openReminder(item: { wallet_card_id: number; benefit_id?: string; expires_on: string }) {
    const card = dashboard?.cards.find(card => card.id === item.wallet_card_id);
    const benefit = card?.benefits.find(benefit => benefit.id === item.benefit_id);
    if (card && benefit?.tracking_type === "spend") {
      const period = benefit.periods.find(period => period.end === item.expires_on);
      setEdit({ mode: "usage", card, benefit, periodKey: period?.key || null });
    } else openCard(item.wallet_card_id);
  }

  function openCard(cardId: number) {
    setTab("wallet");
    history.replaceState(null, "", `?tab=wallet&card=${cardId}`);
    window.setTimeout(() => {
      const card = document.getElementById(`wallet-card-${cardId}`);
      const group = card?.closest("details");
      if (group) group.open = true;
      card?.scrollIntoView({ block: "start", behavior: "auto" });
      card?.focus({ preventScroll: true });
    }, 0);
  }

  const hasDashboard = Boolean(dashboard);
  useEffect(() => {
    if (!hasDashboard) return;
    const query = new URLSearchParams(window.location.search);
    const cardId = Number(query.get("card"));
    if (query.get("tab") !== "wallet" || !cardId) return;
    const timer = window.setTimeout(() => {
      setTab("wallet");
      window.setTimeout(() => {
        const card = document.getElementById(`wallet-card-${cardId}`);
        const group = card?.closest("details"); if (group) group.open = true;
        card?.scrollIntoView({ block: "start" });
      }, 0);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hasDashboard]);

  const walletById = useMemo(() => new Map((dashboard?.cards ?? []).map((card) => [card.id, card])), [dashboard]);
  const attentionCards = dashboard?.cards.filter((card) => card.needs_attention) ?? [];
  const otherCards = dashboard?.cards.filter((card) => !card.needs_attention) ?? [];

  async function mutate(message: string, work: () => Promise<unknown>) {
    try {
      setNotice(null);
      await work();
      await reload();
      setNotice(message);
      return null;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Update failed";
      setNotice(message);
      return message;
    }
  }

  async function recommend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setRecommendBusy(true);
    try {
      const params = new URLSearchParams({
        category: String(form.get("category") || "other"),
        merchant: String(form.get("merchant") || ""),
        amount: String(form.get("amount") || "100"),
        context: JSON.stringify({ channel: form.get("channel") || undefined }),
      });
      setRecommendation(await api<Recommendation>(`/v1/recommend?${params}`));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Recommendation failed");
    } finally {
      setRecommendBusy(false);
    }
  }

  async function addWalletCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await mutate("Card added to your local wallet.", async () => {
      await api("/v1/wallet/cards", { method: "POST", body: JSON.stringify({
        catalog_slug: data.get("catalog_slug"),
        nickname: data.get("nickname") || undefined,
        last_four: data.get("last_four") || undefined,
        opened_on: data.get("opened_on") || undefined,
        membership_year_start: data.get("membership_year_start") || undefined,
      }) });
      form.reset();
    });
  }

  async function addOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await mutate("Offer saved locally.", async () => {
      await api("/v1/offers", { method: "POST", body: JSON.stringify({
        wallet_card_id: Number(data.get("wallet_card_id")),
        merchant: data.get("merchant"),
        title: data.get("title"),
        spend_requirement_usd: Number(data.get("spend_requirement_usd")) || null,
        reward_amount_usd: Number(data.get("reward_amount_usd")) || null,
        expires_on: data.get("expires_on") || null,
        activated: data.get("activated") === "on",
      }) });
      form.reset();
    });
  }

  async function recordUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const data = new FormData(event.currentTarget);
    const failure = await mutate("Period total saved. Previous entries remain in the private audit trail.", async () => {
      if (data.get("membership_year_start")) {
        await api(`/v1/wallet/cards/${edit.card.id}`, { method: "PATCH", body: JSON.stringify({ membership_year_start: data.get("membership_year_start") }) });
      }
      await api("/v1/usage/period", { method: "POST", body: JSON.stringify({
        wallet_card_id: edit.card.id,
        benefit_id: edit.benefit.id,
        amount_usd: Number(data.get("amount_usd")),
        expected_total_usd: Number(data.get("expected_total_usd")),
        request_id: data.get("request_id"),
        used_at: data.get("used_at"),
        period_key: data.get("period_key") || null,
        note: data.get("note") || null,
      }) });
      setEdit(null);
    });
    if (failure) throw new Error(failure);
  }

  async function activateBenefit(card: WalletCard, benefit: Benefit) {
    await mutate(`${benefit.title} marked active. You will not need to log it again.`, async () => {
      await api("/v1/benefit-status", { method: "POST", body: JSON.stringify({
        wallet_card_id: card.id,
        benefit_id: benefit.id,
        status: "active",
        activated_on: dashboard?.as_of,
      }) });
    });
  }

  async function saveMembershipYear(event: FormEvent<HTMLFormElement>, card: WalletCard) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate("Membership-year start saved; anniversary countdowns were recalculated.", async () => {
      await api(`/v1/wallet/cards/${card.id}`, { method: "PATCH", body: JSON.stringify({
        membership_year_start: data.get("membership_year_start") || null,
      }) });
      setCardEdit(null);
    });
  }

  function renderWalletCard(card: WalletCard) {
    const spendBenefits = card.benefits.filter((benefit) => benefit.tracking_type === "spend");
    const includedBenefits = card.benefits.filter((benefit) => benefit.tracking_type !== "spend");
    const includedNeedsAction = includedBenefits.some((benefit) => benefit.is_actionable);

    function renderBenefit(benefit: Benefit, compact = false) {
      const automaticLabel = benefit.points_amount
        ? `${benefit.points_amount.toLocaleString()} points${benefit.catalog_value_usd == null ? "" : ` · ${usd.format(benefit.catalog_value_usd)} est.`}`
        : benefit.amount_usd == null ? "Included automatically" : `${usd.format(benefit.amount_usd)} automatic value`;
      const enrollmentLabel = benefit.status === "active" ? `Active${benefit.activated_on ? ` since ${benefit.activated_on}` : ""}` : "Activate once";
      const detail = benefit.requires_membership_year
        ? benefit.tracking_type === "automatic" ? "Annual automatic value · anniversary date not set" : "Set the anniversary date when logging use to calculate the credit expiry"
        : benefit.tracking_type === "spend"
          ? benefit.periods.length ? RESET_CADENCE_DETAILS[benefit.cadence] : `${benefit.cadence.replaceAll("_", " ")} · expires ${benefit.expires_on}`
          : benefit.description;
      const value = benefit.requires_membership_year && benefit.tracking_type === "spend"
        ? `${usd.format(benefit.amount_usd ?? 0)} annual · date needed`
        : benefit.tracking_type === "spend"
          ? `${usd.format(benefit.remaining_usd ?? 0)} left`
          : benefit.tracking_type === "automatic"
            ? automaticLabel
            : benefit.tracking_type === "enrollment" ? enrollmentLabel : "Reference";
      const valuationLabel = benefit.valuation_method === "face_value"
        ? `${usd.format(benefit.catalog_value_usd ?? 0)} face value`
        : benefit.valuation_method === "points"
          ? `${usd.format(benefit.catalog_value_usd ?? 0)} sourced estimate`
          : benefit.valuation_method === "market_estimate"
            ? `${usd.format(benefit.catalog_value_usd ?? 0)} market estimate`
            : "Not counted in card value";

      return (
        <div className={`benefit tracking-${benefit.tracking_type} ${compact ? "compact-benefit" : ""}`} key={benefit.id}>
          <div className="benefit-title"><span className="benefit-kind">{benefit.tracking_type === "spend" ? benefit.cadence.replaceAll("_", " ") : benefit.tracking_type === "enrollment" ? "set once" : benefit.tracking_type}</span><strong>{benefit.title}</strong><small>{detail}</small></div>
          <div className="benefit-value"><strong>{value}</strong>{benefit.tracking_type === "spend" ? <small>{usd.format(benefit.used_usd)} used</small> : <small className="behavior-label">{benefit.counts_toward_value ? "Included in value" : "Not deducted or counted"}</small>}</div>
          {benefit.periods.length ? <CreditPeriods cadence={benefit.cadence} periods={benefit.periods} asOf={dashboard?.as_of || ""} onSelect={(period) => setEdit({ mode: "usage", card, benefit, periodKey: period.key })} /> : benefit.tracking_type === "spend" && !benefit.requires_membership_year ? <Progress used={benefit.used_usd} total={benefit.amount_usd} /> : null}
          <div className="benefit-actions">
            {benefit.tracking_type === "spend" && !benefit.periods.length ? <button type="button" className="is-primary" onClick={() => setEdit({ mode: "usage", card, benefit, periodKey: null })}>Log use</button> : null}
            {benefit.tracking_type === "enrollment" && benefit.status !== "active" ? <button type="button" className="is-primary" onClick={() => void activateBenefit(card, benefit)}>Mark active</button> : null}
            <span className="catalog-valuation" title={benefit.valuation_basis || undefined}>{valuationLabel}{benefit.valuation_source_url ? <a href={benefit.valuation_source_url} target="_blank" rel="noreferrer">Source ↗</a> : null}</span>
          </div>
        </div>
      );
    }

    return (
      <article id={`wallet-card-${card.id}`} tabIndex={-1} className="wallet-card" key={card.id}>
        <aside className="wallet-card-rail">
          <CardArtwork card={card} />
          <div className="card-identity">
            <div className="card-topline"><span>{card.issuer}</span><small className={card.needs_attention ? "needs-attention" : "is-caught-up"}>{card.needs_attention ? `${card.actionable_benefits_count} to review` : "Caught up"}</small></div>
            <h2>{card.nickname}{card.last_four ? <em>•• {card.last_four}</em> : null}</h2>
            <p>{card.name}</p>
          </div>
          <div className="card-net"><small>Used value minus fee</small><strong className={card.projected_net_usd >= 0 ? "positive" : "negative"}>{card.projected_net_usd >= 0 ? "+" : ""}{usd.format(card.projected_net_usd)}</strong></div>
          <div className="card-values"><span><small>Expected left</small><strong>{usd.format(card.expected_remaining_usd)}</strong></span><span><small>Annual fee</small><strong>{usd.format(card.annual_fee_usd)}</strong></span></div>
          <div className="membership-year"><span><small>Membership year</small><strong>{card.membership_year_start || "Not set"}</strong></span><button type="button" onClick={() => setCardEdit(cardEdit === card.id ? null : card.id)}>{card.membership_year_start ? "Change" : "Set date"}</button></div>
          {cardEdit === card.id ? <form className="inline-editor membership-editor" onSubmit={(event) => saveMembershipYear(event, card)}><label className="wide">Start date from annual-fee record<input name="membership_year_start" type="date" defaultValue={card.membership_year_start || ""} required /></label><button>Save date</button><button type="button" className="ghost" onClick={() => setCardEdit(null)}>Cancel</button></form> : null}
        </aside>
        <section className="wallet-card-body">
          <header className="benefits-heading"><div><p className="eyebrow">CREDITS TO USE</p><h3>{spendBenefits.length ? `${spendBenefits.length} benefit${spendBenefits.length === 1 ? "" : "s"} in play` : "Nothing to use right now"}</h3></div><span className={card.needs_attention ? "" : "caught-up"}>{card.needs_attention ? "Review needed" : "✓ All caught up"}</span></header>
          <div className="benefit-list spend-benefits">{spendBenefits.map((benefit) => renderBenefit(benefit))}</div>
          {includedBenefits.length ? <details className="included-benefits" open={includedNeedsAction || undefined}><summary><span>Included perks &amp; statuses</span><small>{includedBenefits.length} set-once or reference item{includedBenefits.length === 1 ? "" : "s"}</small></summary><div className="benefit-list">{includedBenefits.map((benefit) => renderBenefit(benefit, true))}</div></details> : null}
        </section>
      </article>
    );
  }


  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => setTab("overview")} aria-label="crdits home">
          <span>crd</span><b>its</b>
        </button>
        <nav aria-label="Primary navigation">
          {(["overview", "wallet", "catalog"] as const).map((item) => (
            <button key={item} aria-pressed={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
          ))}
        </nav>
        <div className="privacy-badge"><i /> local ledger</div>
      </header>

      {notice ? <button className="notice" onClick={() => setNotice(null)}>{notice}<span>×</span></button> : null}

      <label className="year-selector">Bookkeeping year <select aria-label="Bookkeeping year" value={year} onChange={event => { setYear(Number(event.target.value)); setEdit(null); }}>{Array.from({ length: new Date().getFullYear() - 2019 }, (_, index) => new Date().getFullYear() - index).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      {error ? (
        <section className="empty-state">
          <small>LOCAL API UNAVAILABLE</small>
          <h1>Your card data is still yours.</h1>
          <p>{error}. Start the local API and refresh; no wallet data is fetched from the cloud.</p>
          <button onClick={() => { setLoading(true); void reload(); }}>Try again</button>
        </section>
      ) : null}

      {(dashboard || !error) && tab === "overview" ? (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">CARDCREDITS · {dashboard?.as_of ?? "LOCAL"}</p>
              <h1>Your card credits,<br /><em>at a glance.</em></h1>
              <p className="hero-copy">See what is available, what needs attention, and which card to use next. Personal activity stays in your private ledger.</p>
            </div>
            <div className="net-orb">
              <span>Remaining this year</span>
              <strong>{dashboard ? usd.format(dashboard.metrics.credits_remaining_usd) : "—"}</strong>
              <small>{dashboard?.reminders.length ?? 0} reminder{dashboard?.reminders.length === 1 ? "" : "s"} · {attentionCards.length} card{attentionCards.length === 1 ? "" : "s"} to review</small>
            </div>
          </section>

          <section className="metrics" aria-label="Portfolio metrics">
            <Metric label="Remaining this year" value={dashboard?.metrics.credits_remaining_usd ?? 0} detail={`${usd.format(dashboard?.metrics.expected_remaining_usd ?? 0)} using sourced catalog values`} />
            <Metric label="Used / credited this year" value={dashboard?.metrics.realized_ytd_usd ?? 0} detail="Recorded in your private ledger" tone="good" />
            <Metric label="Net value this year" value={dashboard?.metrics.projected_net_usd ?? 0} detail={`Used value minus ${usd.format(dashboard?.metrics.annual_fees_usd ?? 0)} in annual fees`} tone={(dashboard?.metrics.projected_net_usd ?? 0) >= 0 ? "good" : "warn"} />
          </section>

          <section className="overview-grid">
            <article className="panel attention-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">ATTENTION QUEUE</p><h2>Use these next</h2></div>
                <span className="count-badge">{dashboard?.reminders.length ?? 0}</span>
              </div>
              <div className="reminder-list">
                {loading ? <p className="muted">Reading the local ledger…</p> : null}
                {!loading && !dashboard?.reminders.length ? <p className="muted">Nothing expires inside your reminder window.</p> : null}
                {dashboard?.reminders.slice(0, 6).map((item) => (
                  <div className={`reminder ${item.severity}`} key={`${item.type}-${item.wallet_card_id}-${item.expires_on}-${item.title}`}>
                    <span className="date-tile"><b>{new Date(`${item.expires_on}T00:00:00`).toLocaleDateString("en-US", { month: "short" })}</b><strong>{item.expires_on.slice(-2)}</strong></span>
                    <div><strong>{item.title}</strong><small>{item.detail} · {item.card_name}</small></div>
                    <button onClick={() => openReminder(item)}>{item.benefit_id ? "Open credit" : "Open card"} →</button>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel recommend-panel">
              <p className="eyebrow">QUICK PICK</p>
              <h2>Which card should I use?</h2>
              <form className="recommend-form" onSubmit={recommend}>
                <label>Purchase category<select name="category" defaultValue="dining"><option>dining</option><option>groceries</option><option>gas</option><option>travel</option><option>hotels</option><option>flights</option><option>car-rental</option><option>vacation-rental</option><option>transit</option><option>streaming</option><option>drugstores</option><option>other</option></select></label>
                <label>Merchant <input name="merchant" placeholder="Optional, e.g. Whole Foods" /></label>
                <label>Amount <span className="money-input"><i>$</i><input name="amount" type="number" min="0" step="0.01" defaultValue="100" /></span></label>
                <label>Booking channel<select name="channel"><option value="">Not specified</option><option value="direct">Direct</option><option value="online">Online grocery</option><option value="bilt-travel">Bilt Travel</option><option value="capital-one-travel">Capital One Travel</option><option value="chase-travel">Chase Travel</option><option value="amex-travel">Amex Travel</option></select></label><button disabled={recommendBusy}>{recommendBusy ? "Calculating…" : "Pick my card →"}</button>
              </form>
              {recommendation?.recommendation[0] ? (
                <div className="recommendation-result">
                  <small>ESTIMATED RETURN</small>
                  <strong>{recommendation.recommendation[0].nickname}{recommendation.recommendation[0].last_four ? ` •${recommendation.recommendation[0].last_four}` : ""}</strong>
                  <p>{recommendation.recommendation[0].rule}</p>
                  <span>{usdPrecise.format(recommendation.recommendation[0].total_value_usd)} expected value</span>
                </div>
              ) : null}
            <p className="recommendation-note">Editorial point values are estimates, not guaranteed cash. Restricted bonuses and unknown spending caps are excluded unless eligibility is confirmed.</p>
              {recommendation && <details><summary>Conditional rates to check</summary>{recommendation.recommendation.map(item => <div key={item.wallet_card_id}>{item.conditional_alternatives?.map(alternative => <p key={alternative.rule_id}><strong>{item.nickname}: {alternative.rule}</strong><br />{alternative.reason}</p>)}</div>)}</details>}
            </article>
          </section>

          <section className="review-section">
            <div className="review-heading"><div><p className="eyebrow">YOUR WALLET</p><h2>Cards to review</h2><span>Spendable credits come first. Automatic perks and quiet cards stay out of the way.</span></div><button onClick={() => setTab("wallet")}>Open wallet →</button></div>
            <div className="review-cards">
              {(attentionCards.length ? attentionCards : dashboard?.cards.slice(0, 4) || []).map((card) => (
                <button key={card.id} onClick={() => openCard(card.id)}><CardArtwork card={card} compact /><span><small>{card.issuer}</small><strong>{card.nickname}</strong><em>{card.actionable_benefits_count ? `${card.actionable_benefits_count} benefit${card.actionable_benefits_count === 1 ? "" : "s"} to review` : "Caught up"}</em></span><b>{usd.format(card.benefits.filter((benefit) => benefit.tracking_type === "spend").reduce((total, benefit) => total + (benefit.remaining_usd || 0), 0))}<small>available</small></b><i>→</i></button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {dashboard && tab === "wallet" ? (
        <section className="section-page">
          <div className="section-title"><div><p className="eyebrow">LOCAL SQLITE</p><h1>Your wallet</h1><p>Each physical card has its own private usage ledger; values come from the public catalog.</p></div><span>{dashboard?.cards.length ?? 0} active</span></div>
          <div className="wallet-grid">
            {attentionCards.map(renderWalletCard)}
          </div>

          {otherCards.length ? <details className="quiet-cards"><summary>{otherCards.length} card{otherCards.length === 1 ? "" : "s"} with no credits to use</summary><div className="wallet-grid">{otherCards.map(renderWalletCard)}</div></details> : null}

          <details className="manage-wallet"><summary><span><strong>Manage wallet</strong><small>Add a card or save a targeted offer</small></span><b>+</b></summary><div className="forms-grid">
              <article className="panel form-panel"><p className="eyebrow">WALLET</p><h2>Add a card</h2><form onSubmit={addWalletCard} className="stack-form"><label>Card product<select name="catalog_slug" required defaultValue=""><option value="" disabled>Choose from catalog</option>{dashboard?.catalog_cards.map((card) => <option key={card.slug} value={card.slug}>{card.issuer} · {card.short_name}</option>)}</select></label><label>Nickname<input name="nickname" placeholder="e.g. Aspire" /></label><label>Last four<input name="last_four" inputMode="numeric" maxLength={4} placeholder="Optional" /></label><div className="split-fields"><label>Opened<input name="opened_on" type="date" /></label><label>Membership year starts<input name="membership_year_start" type="date" /></label></div><button>Add to wallet</button></form></article>
              <article className="panel form-panel"><p className="eyebrow">TARGETED · LOCAL ONLY</p><h2>Add an offer</h2><form onSubmit={addOffer} className="stack-form"><label>Card<select name="wallet_card_id" required>{dashboard?.cards.map((card) => <option key={card.id} value={card.id}>{card.nickname}</option>)}</select></label><div className="split-fields"><label>Merchant<input name="merchant" required /></label><label>Reward $<input name="reward_amount_usd" type="number" min="0" step="0.01" /></label></div><label>Offer<input name="title" placeholder="Spend $100, get $20" required /></label><div className="split-fields"><label>Spend requirement $<input name="spend_requirement_usd" type="number" min="0" /></label><label>Expires<input name="expires_on" type="date" /></label></div><label className="check"><input name="activated" type="checkbox" /> Activated</label><button>Save offer</button></form></article>
          </div></details>
          {dashboard?.offers.length ? <article className="panel offer-table"><div className="panel-heading"><div><p className="eyebrow">SAVED OFFERS</p><h2>Targeted coupons</h2></div></div>{dashboard.offers.map((offer) => <div key={offer.id}><strong>{offer.merchant}</strong><span>{offer.title}</span><small>{walletById.get(offer.wallet_card_id)?.nickname} · {offer.activated ? "activated" : "not activated"} · {offer.expires_on || "no expiry"}</small><b>{offer.reward_amount_usd ? usd.format(offer.reward_amount_usd) : "—"}</b><span className="offer-actions">{!offer.activated && <button onClick={() => void mutate("Marked enrolled locally; issuer enrollment must be completed separately.", () => api(`/v1/offers/${offer.id}`, { method: "PATCH", body: JSON.stringify({ activated: true }) }))}>Mark enrolled</button>}<button onClick={() => void mutate("Offer marked used.", () => api(`/v1/offers/${offer.id}`, { method: "PATCH", body: JSON.stringify({ status: "used" }) }))}>Mark used</button><button onClick={() => void mutate("Offer archived.", () => api(`/v1/offers/${offer.id}`, { method: "PATCH", body: JSON.stringify({ status: "expired" }) }))}>Archive</button></span><details><summary>Edit offer</summary><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate("Offer updated.", () => api(`/v1/offers/${offer.id}`, { method: "PATCH", body: JSON.stringify({ title: form.get("title"), reward_amount_usd: form.get("reward") === "" ? null : Number(form.get("reward")), expires_on: form.get("expires") || null }) })); }}><label>Title<input name="title" defaultValue={offer.title} required /></label><label>Reward $<input name="reward" type="number" step="0.01" min="0" defaultValue={offer.reward_amount_usd ?? ""} /></label><label>Expires<input name="expires" type="date" defaultValue={offer.expires_on || ""} /></label><button>Save offer</button></form></details></div>)}</article> : null}
        </section>
      ) : null}

      {tab === "wallet" && Boolean(dashboard?.offer_history?.length) && <details className="offer-history"><summary>Used and archived offers</summary>{dashboard?.offer_history?.map(offer => <div key={offer.id}><strong>{offer.merchant}: {offer.title}</strong><span> · {offer.status}</span><button onClick={() => void mutate("Offer restored; check its expiry before use.", () => api(`/v1/offers/${offer.id}`, { method: "PATCH", body: JSON.stringify({ status: "available" }) }))}>Restore</button></div>)}</details>}

      {dashboard && tab === "catalog" ? (
        <section className="section-page">
          <div className="section-title"><div><p className="eyebrow">PUBLIC · VERSIONED · GIT</p><h1>Card catalog</h1><p>Community facts live here. Personal usage and targeted offers never do.</p></div><span>{dashboard?.catalog_cards.length ?? 0} cards</span></div>
          <div className="catalog-layout">
            <article className="panel catalog-list">
              {dashboard?.catalog_cards.map((card) => (
                <div key={card.slug}><CardArtwork card={card} compact /><div><strong>{card.name}</strong><small>{card.benefits_count} benefits · {card.reward_rules_count} reward rules · verified {card.verified_at || "never"}</small></div><span>{card.point_value_cents == null ? "cash / unknown" : `${card.point_value_cents}¢ / point`}</span></div>
              ))}
            </article>
            <CatalogEditor cards={dashboard?.catalog_cards || []} onSaved={reload} />
          </div>
        </section>
      ) : null}

      {edit?.mode === "usage" ? <UsageModal key={`${edit.benefit.id}:${edit.periodKey || "open"}`} card={edit.card} benefit={edit.benefit} asOf={dashboard?.as_of || ""} periodKey={edit.periodKey} onSubmit={recordUsage} onCancel={() => setEdit(null)} /> : null}

      <footer><span>crdits</span><p>Public rules in Git. Private history in SQLite.</p><small>{urgent.length ? `${urgent.length} urgent item${urgent.length === 1 ? "" : "s"}` : "Nothing urgent"}</small></footer>
    </main>
  );
}
