"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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
  }>;
};

type BenefitEditor =
  | { mode: "usage"; card: WalletCard; benefit: Benefit; periodKey: string | null }
  | { mode: "value"; card: WalletCard; benefit: Benefit };

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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/crdits${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
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

function CreditPeriods({ periods, asOf, onSelect }: { periods: BenefitPeriod[]; asOf: string; onSelect: (period: BenefitPeriod) => void }) {
  return (
    <div className={`credit-periods has-${periods.length}`} aria-label="Credit periods">
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
          <button type="button" className={`credit-period is-${period.status} ${period.is_current ? "is-current" : ""}`} key={period.key} aria-current={period.is_current ? "true" : undefined} disabled={!selectable} onClick={() => onSelect(period)} title={selectable ? `Bookkeep usage from ${period.start} through ${period.end}` : `Upcoming period: ${period.start} through ${period.end}`}>
            <small>{period.label}</small><strong>{detail}</strong><i>{period.is_current ? "Current" : period.status}</i>
          </button>
        );
      })}
    </div>
  );
}

function UsageEditor({ benefit, asOf, initialPeriodKey, onSubmit, onCancel }: {
  benefit: Benefit;
  asOf: string;
  initialPeriodKey: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const selectablePeriods = benefit.periods.filter((period) => period.start <= asOf);
  const initialPeriod = selectablePeriods.find((period) => period.key === initialPeriodKey)
    || selectablePeriods.find((period) => period.is_current)
    || selectablePeriods.at(-1);
  const [periodKey, setPeriodKey] = useState(initialPeriod?.key || "");
  const selectedPeriod = selectablePeriods.find((period) => period.key === periodKey);
  const defaultDate = selectedPeriod ? selectedPeriod.is_current ? asOf : "" : asOf;
  const maxDate = selectedPeriod && selectedPeriod.end < asOf ? selectedPeriod.end : asOf;
  const defaultAmount = selectedPeriod?.remaining_usd ?? benefit.remaining_usd ?? 0;

  return (
    <form className="inline-editor" onSubmit={onSubmit}>
      {selectablePeriods.length ? (
        <label className="wide">Credit period
          <select name="period_key" value={periodKey} onChange={(event) => setPeriodKey(event.target.value)}>
            {selectablePeriods.map((period) => <option value={period.key} key={period.key}>{period.label} · {period.start} to {period.end} · {usd.format(period.used_usd)} used</option>)}
          </select>
        </label>
      ) : null}
      {selectedPeriod ? <p className="wide usage-period-note">This entry will update {selectedPeriod.label} only. {selectedPeriod.is_current ? "It is the current period." : `Use the actual date when known. Otherwise use ${selectedPeriod.end} as a period-end marker and explain that in the note.`}</p> : null}
      <label key={`amount-${periodKey}`}>Amount<input name="amount_usd" type="number" step="0.01" min="0.01" defaultValue={defaultAmount || ""} required /></label>
      <label key={`date-${periodKey}`}>Date<input name="used_at" type="date" min={selectedPeriod?.start} max={maxDate} defaultValue={defaultDate} required /></label>
      <label className="wide">Note<input name="note" placeholder={selectedPeriod && !selectedPeriod.is_current ? `Optional historical ${selectedPeriod.label} note` : "Optional"} /></label>
      <button>{selectedPeriod ? `Save ${selectedPeriod.label} usage` : "Save usage"}</button><button type="button" className="ghost" onClick={onCancel}>Cancel</button>
    </form>
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "wallet" | "catalog">("overview");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendBusy, setRecommendBusy] = useState(false);
  const [edit, setEdit] = useState<BenefitEditor | null>(null);
  const [cardEdit, setCardEdit] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const data = await api<Dashboard>("/v1/dashboard");
      setDashboard(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load crdits");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const urgent = dashboard?.reminders.filter((item) => item.severity === "urgent") ?? [];
  const walletById = useMemo(() => new Map((dashboard?.cards ?? []).map((card) => [card.id, card])), [dashboard]);
  const attentionCards = dashboard?.cards.filter((card) => card.needs_attention) ?? [];
  const otherCards = dashboard?.cards.filter((card) => !card.needs_attention) ?? [];

  async function mutate(message: string, work: () => Promise<unknown>) {
    try {
      setNotice(null);
      await work();
      await reload();
      setNotice(message);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Update failed");
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
    await mutate("Usage recorded. The ledger and projections are updated.", async () => {
      await api("/v1/usage", { method: "POST", body: JSON.stringify({
        wallet_card_id: edit.card.id,
        benefit_id: edit.benefit.id,
        amount_usd: Number(data.get("amount_usd")),
        used_at: data.get("used_at"),
        period_key: data.get("period_key") || null,
        note: data.get("note") || null,
      }) });
      setEdit(null);
    });
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

  async function saveValue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const data = new FormData(event.currentTarget);
    await mutate("Personal value assumptions saved locally.", async () => {
      await api("/v1/preferences", { method: "POST", body: JSON.stringify({
        wallet_card_id: edit.card.id,
        benefit_id: edit.benefit.id,
        probability: Number(data.get("probability")) / 100,
        personal_value_percent: Number(data.get("personal_value_percent")) / 100,
        face_value_override: data.get("face_value_override") ? Number(data.get("face_value_override")) : null,
        reminder_days: Number(data.get("reminder_days")) || null,
      }) });
      setEdit(null);
    });
  }

  function renderWalletCard(card: WalletCard) {
    return (
      <article className="wallet-card" key={card.id}>
        <div className="card-identity">
          <CardArtwork card={card} />
          <div>
            <div className="card-topline"><span>{card.issuer}</span><small className={card.needs_attention ? "needs-attention" : "is-caught-up"}>{card.needs_attention ? `${card.actionable_benefits_count} to review` : "Caught up"}</small></div>
            <h2>{card.nickname}{card.last_four ? <em>•• {card.last_four}</em> : null}</h2>
            <p>{card.name}</p>
          </div>
        </div>
        <div className="membership-year">
          <span><small>Membership year starts</small><strong>{card.membership_year_start || "Not set"}</strong></span>
          <button type="button" onClick={() => setCardEdit(cardEdit === card.id ? null : card.id)}>{card.membership_year_start ? "Change" : "Set date"}</button>
        </div>
        {cardEdit === card.id ? (
          <form className="inline-editor membership-editor" onSubmit={(event) => saveMembershipYear(event, card)}>
            <label className="wide">Start date from your annual-fee record<input name="membership_year_start" type="date" defaultValue={card.membership_year_start || ""} required /></label>
            <button>Save membership year</button><button type="button" className="ghost" onClick={() => setCardEdit(null)}>Cancel</button>
          </form>
        ) : null}
        <div className="card-values"><span><small>Expected left</small><strong>{usd.format(card.expected_remaining_usd)}</strong></span><span><small>Annual fee</small><strong>{usd.format(card.annual_fee_usd)}</strong></span><span><small>Projected net</small><strong className={card.projected_net_usd >= 0 ? "positive" : "negative"}>{usd.format(card.projected_net_usd)}</strong></span></div>
        <div className="benefit-list">
          {card.benefits.map((benefit) => {
            const currentPeriod = benefit.periods.find((period) => period.is_current);
            const pastPeriods = benefit.periods.filter((period) => period.end < (dashboard?.as_of || ""));
            const latestPastPeriod = pastPeriods.at(-1);
            const splitCadenceLabel = benefit.cadence === "quarterly" ? "Quarterly credit · each quarter resets" : "Semiannual credit · each half resets";
            const automaticLabel = benefit.points_amount
              ? `${benefit.points_amount.toLocaleString()} points · ${benefit.amount_usd == null ? "value not set" : `${usd.format(benefit.amount_usd)} estimated value`}`
              : benefit.amount_usd == null ? "Included automatically" : `${usd.format(benefit.amount_usd)} automatic value`;
            const enrollmentLabel = benefit.status === "active"
              ? `Active${benefit.activated_on ? ` since ${benefit.activated_on}` : ""}`
              : "One-time activation";
            return (
              <div className={`benefit tracking-${benefit.tracking_type}`} key={benefit.id}>
                <div className="benefit-title"><strong>{benefit.title}</strong><small>{benefit.requires_membership_year ? "Set the membership-year date for a true countdown" : benefit.tracking_type === "spend" ? benefit.periods.length ? splitCadenceLabel : `${benefit.cadence.replaceAll("_", " ")} · expires ${benefit.expires_on}` : benefit.description}</small></div>
                <div className="benefit-value"><strong>{benefit.requires_membership_year ? "Date needed" : benefit.tracking_type === "spend" ? `${usd.format(benefit.remaining_usd ?? 0)} left` : benefit.tracking_type === "automatic" ? automaticLabel : benefit.tracking_type === "enrollment" ? enrollmentLabel : "Reference benefit"}</strong>{benefit.tracking_type === "spend" ? <small>{usd.format(benefit.used_usd)} used</small> : <small className="behavior-label">{benefit.tracking_type}{benefit.counts_toward_value ? "" : " · not counted"}</small>}</div>
                {benefit.periods.length ? <CreditPeriods periods={benefit.periods} asOf={dashboard?.as_of || ""} onSelect={(period) => setEdit({ mode: "usage", card, benefit, periodKey: period.key })} /> : benefit.tracking_type === "spend" && !benefit.requires_membership_year ? <Progress used={benefit.used_usd} total={benefit.amount_usd} /> : null}
                <div className="benefit-actions">
                  {benefit.tracking_type === "spend" && !benefit.requires_membership_year ? <button type="button" className="is-primary" onClick={() => setEdit({ mode: "usage", card, benefit, periodKey: currentPeriod?.key || null })}>Log {currentPeriod ? `${currentPeriod.label} use` : "use"}</button> : null}
                  {latestPastPeriod ? <button type="button" onClick={() => setEdit({ mode: "usage", card, benefit, periodKey: latestPastPeriod.key })}>Bookkeep past</button> : null}
                  {benefit.tracking_type === "enrollment" && benefit.status !== "active" ? <button type="button" onClick={() => void activateBenefit(card, benefit)}>Mark active once</button> : null}
                  {benefit.tracking_type === "spend" || benefit.counts_toward_value ? <button type="button" onClick={() => setEdit({ mode: "value", card, benefit })}>Value {Math.round(benefit.probability * benefit.personal_value_percent * 100)}%</button> : null}
                </div>
                {edit?.card.id === card.id && edit.benefit.id === benefit.id ? (
                  edit.mode === "usage" ? (
                    <UsageEditor key={`${benefit.id}:${edit.periodKey || "open"}`} benefit={benefit} asOf={dashboard?.as_of || ""} initialPeriodKey={edit.periodKey} onSubmit={recordUsage} onCancel={() => setEdit(null)} />
                  ) : (
                    <form className="inline-editor" onSubmit={saveValue}>
                      <label>Chance of value %<input name="probability" type="number" min="0" max="100" defaultValue={Math.round(benefit.probability * 100)} /></label>
                      <label>Personal value %<input name="personal_value_percent" type="number" min="0" max="100" defaultValue={Math.round(benefit.personal_value_percent * 100)} /></label>
                      <label>Face value override<input name="face_value_override" type="number" min="0" step="0.01" defaultValue={benefit.amount_usd ?? ""} /></label>
                      <label>Remind days before<input name="reminder_days" type="number" min="0" defaultValue="30" /></label>
                      <button>Save value</button><button type="button" className="ghost" onClick={() => setEdit(null)}>Cancel</button>
                    </form>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  async function updateCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get("update_kind"));
    const slug = String(data.get("card_slug"));
    const body = Object.fromEntries([...data.entries()].filter(([key, value]) => !["update_kind", "card_slug"].includes(key) && value !== ""));
    if (kind !== "benefit") {
      delete body.tracking_type;
      delete body.points_amount;
    }
    const route = kind === "benefit" ? "benefits" : kind === "reward" ? "rewards" : "";
    const method = kind === "facts" ? "PATCH" : "POST";
    const url = kind === "facts" ? `/v1/catalog/cards/${slug}` : `/v1/catalog/cards/${slug}/${route}`;
    await mutate("Public catalog updated in the repository. Review and commit the generated diff.", async () => {
      await api(url, { method, body: JSON.stringify(body) });
      form.reset();
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => setTab("overview")} aria-label="crdits home">
          <span>crd</span><b>its</b>
        </button>
        <nav aria-label="Primary navigation">
          {(["overview", "wallet", "catalog"] as const).map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
          ))}
        </nav>
        <div className="privacy-badge"><i /> local ledger</div>
      </header>

      {notice ? <button className="notice" onClick={() => setNotice(null)}>{notice}<span>×</span></button> : null}

      {error ? (
        <section className="empty-state">
          <small>LOCAL API UNAVAILABLE</small>
          <h1>Your card data is still yours.</h1>
          <p>{error}. Start the local API and refresh; no wallet data is fetched from the cloud.</p>
          <button onClick={() => { setLoading(true); void reload(); }}>Try again</button>
        </section>
      ) : null}

      {!error && tab === "overview" ? (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">CARD VALUE LEDGER · {dashboard?.as_of ?? "LOCAL"}</p>
              <h1>Your card value,<br /><em>minus the wishful thinking.</em></h1>
              <p className="hero-copy">Credits used, value still at risk, and the right card for the next purchase—without bank logins.</p>
            </div>
            <div className="net-orb">
              <span>Projected net</span>
              <strong>{dashboard ? usd.format(dashboard.metrics.projected_net_usd) : "—"}</strong>
              <small>realized + expected − fees</small>
            </div>
          </section>

          <section className="metrics" aria-label="Portfolio metrics">
            <Metric label="Realized this year" value={dashboard?.metrics.realized_ytd_usd ?? 0} detail="Usage ledger" tone="good" />
            <Metric label="Credits remaining" value={dashboard?.metrics.credits_remaining_usd ?? 0} detail="Face value through year-end" />
            <Metric label="Expected remaining" value={dashboard?.metrics.expected_remaining_usd ?? 0} detail="Probability × personal value" tone="good" />
            <Metric label="Targeted offers" value={dashboard?.metrics.targeted_offers_usd ?? 0} detail="Excluded from expected value" />
            <Metric label="Annual fees" value={dashboard?.metrics.annual_fees_usd ?? 0} detail={`${dashboard?.cards.length ?? 0} active cards`} tone="warn" />
          </section>

          <section className="overview-grid">
            <article className="panel attention-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">MONEY AT RISK</p><h2>Use these next</h2></div>
                <span className="count-badge">{dashboard?.reminders.length ?? 0}</span>
              </div>
              <div className="reminder-list">
                {loading ? <p className="muted">Reading the local ledger…</p> : null}
                {!loading && !dashboard?.reminders.length ? <p className="muted">Nothing expires inside your reminder window.</p> : null}
                {dashboard?.reminders.slice(0, 6).map((item) => (
                  <div className={`reminder ${item.severity}`} key={`${item.type}-${item.wallet_card_id}-${item.expires_on}-${item.title}`}>
                    <span className="date-tile"><b>{new Date(`${item.expires_on}T00:00:00`).toLocaleDateString("en-US", { month: "short" })}</b><strong>{item.expires_on.slice(-2)}</strong></span>
                    <div><strong>{item.title}</strong><small>{item.detail} · {item.card_name}</small></div>
                    <i>{item.severity === "urgent" ? "now" : "soon"}</i>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel recommend-panel">
              <p className="eyebrow">QUICK PICK</p>
              <h2>Which card should I use?</h2>
              <form className="recommend-form" onSubmit={recommend}>
                <label>Purchase category<select name="category" defaultValue="dining"><option>dining</option><option>groceries</option><option>gas</option><option>travel</option><option>transit</option><option>streaming</option><option>drugstores</option><option>other</option></select></label>
                <label>Merchant <input name="merchant" placeholder="Optional, e.g. Whole Foods" /></label>
                <label>Amount <span className="money-input"><i>$</i><input name="amount" type="number" min="0" step="0.01" defaultValue="100" /></span></label>
                <button disabled={recommendBusy}>{recommendBusy ? "Calculating…" : "Pick my card →"}</button>
              </form>
              {recommendation?.recommendation[0] ? (
                <div className="recommendation-result">
                  <small>BEST EXPECTED RETURN</small>
                  <strong>{recommendation.recommendation[0].nickname}{recommendation.recommendation[0].last_four ? ` •${recommendation.recommendation[0].last_four}` : ""}</strong>
                  <p>{recommendation.recommendation[0].rule}</p>
                  <span>{usdPrecise.format(recommendation.recommendation[0].total_value_usd)} expected value</span>
                </div>
              ) : null}
            </article>
          </section>

          <section className="portfolio-strip">
            <div><p className="eyebrow">PORTFOLIO</p><h2>Every fee has to earn its place.</h2></div>
            <div className="mini-cards">
              {dashboard?.cards.slice(0, 4).map((card) => (
                <button key={card.id} onClick={() => setTab("wallet")}>
                  <CardArtwork card={card} compact /><span>{card.issuer}</span><strong>{card.nickname}</strong><small className={card.projected_net_usd >= 0 ? "positive" : "negative"}>{card.projected_net_usd >= 0 ? "+" : ""}{usd.format(card.projected_net_usd)} projected</small>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {!error && tab === "wallet" ? (
        <section className="section-page">
          <div className="section-title"><div><p className="eyebrow">LOCAL SQLITE</p><h1>Your wallet</h1><p>Each physical card has its own usage ledger and assumptions.</p></div><span>{dashboard?.cards.length ?? 0} active</span></div>
          <div className="wallet-grid">
            {attentionCards.map(renderWalletCard)}
          </div>

          {otherCards.length ? <details className="quiet-cards"><summary>{otherCards.length} card{otherCards.length === 1 ? "" : "s"} with no credits to use</summary><div className="wallet-grid">{otherCards.map(renderWalletCard)}</div></details> : null}

          <div className="forms-grid">
            <article className="panel form-panel"><p className="eyebrow">WALLET</p><h2>Add a card</h2><form onSubmit={addWalletCard} className="stack-form"><label>Card product<select name="catalog_slug" required defaultValue=""><option value="" disabled>Choose from catalog</option>{dashboard?.catalog_cards.map((card) => <option key={card.slug} value={card.slug}>{card.issuer} · {card.short_name}</option>)}</select></label><label>Nickname<input name="nickname" placeholder="e.g. Aspire" /></label><label>Last four<input name="last_four" inputMode="numeric" maxLength={4} placeholder="Optional" /></label><div className="split-fields"><label>Opened<input name="opened_on" type="date" /></label><label>Membership year starts<input name="membership_year_start" type="date" /></label></div><button>Add to wallet</button></form></article>
            <article className="panel form-panel"><p className="eyebrow">TARGETED · LOCAL ONLY</p><h2>Add an offer</h2><form onSubmit={addOffer} className="stack-form"><label>Card<select name="wallet_card_id" required>{dashboard?.cards.map((card) => <option key={card.id} value={card.id}>{card.nickname}</option>)}</select></label><div className="split-fields"><label>Merchant<input name="merchant" required /></label><label>Reward $<input name="reward_amount_usd" type="number" min="0" step="0.01" /></label></div><label>Offer<input name="title" placeholder="Spend $100, get $20" required /></label><div className="split-fields"><label>Spend requirement $<input name="spend_requirement_usd" type="number" min="0" /></label><label>Expires<input name="expires_on" type="date" /></label></div><label className="check"><input name="activated" type="checkbox" /> Activated</label><button>Save offer</button></form></article>
          </div>
          {dashboard?.offers.length ? <article className="panel offer-table"><div className="panel-heading"><div><p className="eyebrow">SAVED OFFERS</p><h2>Targeted coupons</h2></div></div>{dashboard.offers.map((offer) => <div key={offer.id}><strong>{offer.merchant}</strong><span>{offer.title}</span><small>{walletById.get(offer.wallet_card_id)?.nickname} · {offer.activated ? "activated" : "not activated"} · {offer.expires_on || "no expiry"}</small><b>{offer.reward_amount_usd ? usd.format(offer.reward_amount_usd) : "—"}</b></div>)}</article> : null}
        </section>
      ) : null}

      {!error && tab === "catalog" ? (
        <section className="section-page">
          <div className="section-title"><div><p className="eyebrow">PUBLIC · VERSIONED · GIT</p><h1>Card catalog</h1><p>Community facts live here. Personal usage and targeted offers never do.</p></div><span>{dashboard?.catalog_cards.length ?? 0} cards</span></div>
          <div className="catalog-layout">
            <article className="panel catalog-list">
              {dashboard?.catalog_cards.map((card) => (
                <div key={card.slug}><CardArtwork card={card} compact /><div><strong>{card.name}</strong><small>{card.benefits_count} benefits · {card.reward_rules_count} reward rules · verified {card.verified_at || "never"}</small></div><span>{card.point_value_cents == null ? "cash / unknown" : `${card.point_value_cents}¢ / point`}</span></div>
              ))}
            </article>
            <article className="panel form-panel catalog-editor">
              <p className="eyebrow">STRUCTURED UPDATE</p><h2>Update the repository</h2>
              <p>Every replacement archives the prior definition before writing the new one.</p>
              <form className="stack-form" onSubmit={updateCatalog}>
                <label>Card<select name="card_slug" required>{dashboard?.catalog_cards.map((card) => <option key={card.slug} value={card.slug}>{card.short_name}</option>)}</select></label>
                <label>Update type<select name="update_kind" defaultValue="benefit"><option value="benefit">Benefit / credit</option><option value="reward">Reward category</option><option value="facts">Fee or point value</option></select></label>
                <label>Title or label<input name="title" placeholder="e.g. Dining credit" /></label>
                <div className="split-fields"><label>Benefit behavior<select name="tracking_type" defaultValue="spend"><option value="spend">Spendable credit</option><option value="automatic">Automatic</option><option value="enrollment">Activate once</option><option value="reference">Reference only</option></select></label><label>Points amount<input name="points_amount" placeholder="e.g. 10000" type="number" step="1" /></label></div>
                <div className="split-fields"><label>Benefit amount<input name="amount_usd" placeholder="USD value" type="number" step="0.01" /></label><label>Reward rate<input name="rate" placeholder="e.g. 4" type="number" step="0.01" /></label></div>
                <div className="split-fields"><label>Cadence<select name="cadence" defaultValue="annual"><option>monthly</option><option>quarterly</option><option>semiannual</option><option>annual</option><option>anniversary</option><option>one_time</option></select></label><label>Category<input name="category" placeholder="dining" /></label></div>
                <div className="split-fields"><label>Rate type<select name="rate_type" defaultValue="points_multiplier"><option value="points_multiplier">Points multiplier</option><option value="cashback_percent">Cashback percent</option></select></label><label>Match terms<input name="match_terms" placeholder="dining, restaurants" /></label></div>
                <div className="split-fields"><label>Annual fee<input name="annual_fee_usd" type="number" step="0.01" /></label><label>Point value ¢<input name="point_value_cents" type="number" step="0.01" /></label></div>
                <label>Official source URL<input name="source_url" type="url" placeholder="https://issuer.example/…" /></label>
                <label>Effective from<input name="valid_from" type="date" defaultValue={dashboard?.as_of} /></label>
                <label>Details<textarea name="description" rows={3} placeholder="Trigger, enrollment, restrictions, and relevant terms" /></label>
                <button>Write catalog update</button>
              </form>
            </article>
          </div>
        </section>
      ) : null}

      <footer><span>crdits</span><p>Public rules in Git. Private history in SQLite.</p><small>{urgent.length ? `${urgent.length} urgent item${urgent.length === 1 ? "" : "s"}` : "Nothing urgent"}</small></footer>
    </main>
  );
}
