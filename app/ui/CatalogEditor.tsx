"use client";

import { useEffect, useState } from "react";
type Definition = Record<string, unknown> & { id?: string; title?: string; label?: string; valuation?: Record<string, unknown> };
type CatalogCard = Definition & { benefits: Definition[]; reward_rules: Definition[]; reward_currency?: Record<string, unknown> };
type Props = { cards: { slug: string; short_name: string }[]; onSaved: () => Promise<void> };
const fields = {
  benefit: [["title", "Title"], ["amount_usd", "Credit amount ($)"], ["points_amount", "Points"], ["cadence", "Cadence"], ["tracking_type", "Tracking behavior"], ["description", "Terms"], ["source_url", "Source URL"], ["valuation_method", "Valuation method"], ["valuation_value_usd", "Sourced value ($)"], ["valuation_basis", "Valuation basis"], ["valuation_source_url", "Valuation source URL"], ["valuation_as_of", "Valuation date"], ["valid_from", "Effective from"], ["valid_to", "Effective until"]],
  reward: [["label", "Label"], ["category", "Category"], ["rate", "Rate"], ["rate_type", "Rate type"], ["source_url", "Source URL"]],
  facts: [["annual_fee_usd", "Annual fee ($)"], ["point_value_cents", "Point value (cents)"], ["valuation_source_url", "Valuation source URL"], ["valuation_basis", "Valuation basis"], ["valuation_as_of", "Valuation date"]],
} as const;
const choices: Record<string, string[]> = {
  cadence: ["monthly", "quarterly", "semiannual", "annual", "anniversary", "one_time", "every_n_years"],
  tracking_type: ["spend", "automatic", "enrollment", "reference"],
  valuation_method: ["face_value", "points", "market_estimate", "excluded"],
  rate_type: ["points_multiplier", "cashback_percent", "text_only"],
};
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`/api/crdits${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Catalog request failed");
  return result;
}
export function CatalogEditor({ cards, onSaved }: Props) {
  const [slug, setSlug] = useState(cards[0]?.slug || "");
  const selectedSlug = slug || cards[0]?.slug || "";
  const [kind, setKind] = useState<keyof typeof fields>("benefit");
  const [catalog, setCatalog] = useState<CatalogCard | null>(null);
  const [id, setId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (selectedSlug) request(`/v1/catalog/cards/${encodeURIComponent(selectedSlug)}`).then(card => { if (active) setCatalog(card); }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [selectedSlug]);
  const records = kind === "benefit" ? catalog?.benefits || [] : kind === "reward" ? catalog?.reward_rules || [] : [];
  function select(recordId: string, mode = kind) {
    const record = mode === "facts" ? { ...catalog, ...catalog?.reward_currency } : (mode === "benefit" ? catalog?.benefits : catalog?.reward_rules)?.find(item => item.id === recordId);
    const valuation = record?.valuation as Record<string, unknown> | undefined;
    const flattened: Definition = { ...record, ...(valuation ? { valuation_method: valuation.method, valuation_value_usd: valuation.value_usd, valuation_basis: valuation.basis, valuation_source_url: valuation.source_url, valuation_as_of: valuation.as_of } : {}) };
    const form = Object.fromEntries(fields[mode].map(([key]) => [key, flattened[key] == null ? "" : String(flattened[key])]));
    setId(recordId); setValues(form); setOriginal(form); setReview(false); setMessage("");
  }
  const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== original[key] && (value !== "" || id)).map(([key, value]) => [key, value === "" ? null : value]));
  return <article className="catalog-patch-editor">
    <h2>Edit catalog facts</h2>
    <p>Choose an existing definition to preserve its ID, terms and valuation. This editor writes public facts only.</p>
    <label>Card<select value={selectedSlug} onChange={event => { setSlug(event.target.value); setCatalog(null); setKind("benefit"); setId(""); setValues({}); setOriginal({}); setReview(false); setMessage(""); }}>{cards.map(card => <option key={card.slug} value={card.slug}>{card.short_name}</option>)}</select></label>
    <label>Update type<select value={kind} onChange={event => { const mode = event.target.value as keyof typeof fields; setKind(mode); select("", mode); }}><option value="benefit">Benefit</option><option value="reward">Reward rate</option><option value="facts">Fee / point value</option></select></label>
    {kind !== "facts" && <label>Definition<select value={id} onChange={event => select(event.target.value)}><option value="">New definition</option>{records.map(record => <option key={record.id} value={record.id}>{record.title || record.label} · {record.id}</option>)}</select></label>}
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || !Object.keys(changes).length) return;
      if (!review) { setReview(true); return; }
      setBusy(true); setMessage("");
      try {
        await request(`/v1/catalog/cards/${encodeURIComponent(selectedSlug)}${kind === "facts" ? "" : kind === "benefit" ? "/benefits" : "/rewards"}`, { method: kind === "facts" ? "PATCH" : "POST", body: JSON.stringify({ ...(id ? { id } : {}), ...changes }) });
        setCatalog(await request(`/v1/catalog/cards/${encodeURIComponent(selectedSlug)}`));
        setOriginal(values); setReview(false);
        setMessage("Saved to the local catalog. Git commit/push is still pending; ask Teleclaw to review and publish these public changes.");
        await onSaved();
      } catch (error) { setMessage(error instanceof Error ? error.message : "Update failed"); }
      finally { setBusy(false); }
    }}>
      {fields[kind].map(([key, label]) => <label key={key}>{label}{choices[key] ? <select value={values[key] || ""} onChange={event => { setValues({ ...values, [key]: event.target.value }); setReview(false); }}><option value="">Unchanged / default</option>{choices[key].map(value => <option key={value}>{value}</option>)}</select> : <input value={values[key] || ""} onChange={event => { setValues({ ...values, [key]: event.target.value }); setReview(false); }} type={key.endsWith("_url") ? "url" : key === "valuation_as_of" || key.startsWith("valid_") ? "date" : "text"} required={!id && (key === "title" || key === "label")} />}</label>)}
      {review && <div><h3>Review changes</h3><pre>{JSON.stringify({ id: id || "(new)", changes }, null, 2)}</pre></div>}
      <button disabled={busy || !catalog || !Object.keys(changes).length}>{busy ? "Saving…" : review ? "Confirm local update" : "Review changes"}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </article>;
}
