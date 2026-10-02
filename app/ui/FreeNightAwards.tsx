"use client";

import { useEffect, useRef, useState } from "react";
import "./free-night-awards.css";

export type FreeNightAward = {
  id: number; label: string; issued_on: string | null; expires_on: string | null;
  used_on: string | null; value_usd: number; revision: number;
  expires?: number | boolean;
  used_year?: number | null;
  used_year_confidence?: "confirmed" | "estimated";
  note?: string | null;
  value_basis?: "catalog_estimate" | "user_override";
  stay_deadline?: string;
  status: "available" | "used" | "expired" | "unknown_expiry"; days_remaining: number | null;
};
export type FreeNightBenefit = {
  id: string; title: string; catalog_value_usd: number | null;
  valuation_source_url: string | null; valuation_basis: string | null;
  certificate_policy?: { expires: boolean; expiry_months: number | null; rule: string; source_url: string; stay_deadline: string };
  awards?: FreeNightAward[];
  next_anniversary_on?: string | null;
};
type Editor = { mode: "add" | "use" | "edit"; award?: FreeNightAward };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function AwardDialog({ editor, benefit, asOf, onCancel, onSave }: {
  editor: Editor; benefit: FreeNightBenefit; asOf: string;
  onCancel: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const attempted = useRef<string | null>(null);
  const award = editor.award;
  const use = editor.mode === "use";
  const expires = Boolean(award?.expires ?? benefit.certificate_policy?.expires);
  const [alreadyUsed, setAlreadyUsed] = useState(Boolean(award?.used_on || award?.used_year));
  const [stayDate, setStayDate] = useState(award?.used_on || "");
  const value = award?.value_usd ?? benefit.catalog_value_usd ?? 0;
  const stayLabel = (award?.stay_deadline || benefit.certificate_policy?.stay_deadline) === "checkin_by" ? "Stay check-in date" : "Stay checkout date";

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  return <dialog ref={dialog} className="fna-dialog" onCancel={onCancel}>
    <section className="fna-modal" aria-labelledby="fna-title">
      <header><h3 id="fna-title">{use ? "Use free night" : award ? "Correct award" : "Record free-night award"}</h3><button type="button" aria-label="Close award dialog" onClick={onCancel}>×</button></header>
      <p>{benefit.title}</p>
      <p className="fna-muted">{money.format(value)} {award?.value_basis === "user_override" ? "recorded value" : "sourced estimate"}. {expires ? "Counts toward net only after your stay—not when booked or issued." : "Counts automatically in the year issued, without logging use."}</p>
      <form onSubmit={async event => {
        event.preventDefault();
        if (lock.current) return;
        const data = new FormData(event.currentTarget);
        const input = {
          ...(award ? { id: award.id, expected_revision: award.revision } : {}),
          ...(use ? { used_on: String(data.get("used_on")), value_usd: Number(data.get("value_usd")) } : {
            issued_on: data.get("issued_on") || null, expires_on: expires ? data.get("expires_on") || null : null,
            label: String(data.get("label") || "Annual free night"),
            ...(alreadyUsed ? { used_on: data.get("used_on") || null,
              ...(!data.get("used_on") ? { used_year: Number(data.get("used_year")), used_year_confidence: data.get("used_year_confidence") || "confirmed" } : {}),
            } : award ? { used_on: null, used_year: null } : {}),
            ...(award || alreadyUsed ? { value_usd: Number(data.get("value_usd")) } : {}),
            ...(award ? { voided: data.get("voided") === "on" } : {}),
            note: data.get("note") || null,
          }),
        };
        // Retrying identical input keeps its key; correcting failed input gets
        // a new key so an uncertain network response cannot create duplicates.
        const fingerprint = JSON.stringify(input);
        if (attempted.current !== fingerprint) { requestId.current = crypto.randomUUID(); attempted.current = fingerprint; }
        lock.current = true; setSaving(true); setError(null);
        try { await onSave({ ...input, request_id: requestId.current }); onCancel(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed"); }
        finally { lock.current = false; setSaving(false); }
      }}>
        {use ? <label>{stayLabel}<input type="date" name="used_on" defaultValue={asOf} min={award?.issued_on || undefined} max={asOf} required /></label> : <>
          <label>Issued on{expires ? " (optional if unknown)" : ""}<input type="date" name="issued_on" defaultValue={award?.issued_on || ""} max={asOf} required={!expires} /></label>
          {expires ? <label>Expires on<input type="date" name="expires_on" defaultValue={award?.expires_on || ""} required={!alreadyUsed} /><small>Use the actual date in your hotel account or award email—not the annual-fee date. Past used awards may leave an unknown expiry blank.</small></label> : null}
        </>}
        <details><summary>{use ? "Adjust the value (optional)" : "Details / past use"}</summary>
          {!use ? <label>Award label<input name="label" maxLength={120} defaultValue={award?.label || "Annual free night"} /><small>Use a distinct label for an additional spend-earned award. Do not enter a redeemable certificate code.</small></label> : null}
          {!use ? <label className="fna-checkbox"><input type="checkbox" checked={alreadyUsed} onChange={event => setAlreadyUsed(event.target.checked)} />Already used for a completed stay</label> : null}
          {!use && alreadyUsed ? <>
            <label>{stayLabel} (optional if unknown)<input type="date" name="used_on" value={stayDate} onChange={event => setStayDate(event.target.value)} max={asOf} /></label>
            {!stayDate ? <><label>Bookkeeping year<input type="number" name="used_year" min="2000" max={Number(asOf.slice(0, 4))} defaultValue={award?.used_year || Number(asOf.slice(0, 4))} required /></label><label>Year certainty<select name="used_year_confidence" defaultValue={award?.used_year_confidence || "confirmed"}><option value="confirmed">Confirmed year</option><option value="estimated">Estimated year</option></select><small>No exact stay date is invented. The selected year controls annual net value.</small></label></> : null}
          </> : null}
          {use || award || alreadyUsed ? <label>Value counted ($)<input name="value_usd" type="number" min="0" max="100000" step="0.01" defaultValue={value} required /><small>The sourced estimate is filled in. Change it only to the value attributable to this certificate, excluding extra points and fees.</small></label> : null}
          <label>Private note (optional)<input name="note" maxLength={1000} defaultValue={award?.note || ""} /></label>
          {award && !use ? <label className="fna-checkbox"><input type="checkbox" name="voided" />Remove a mistaken award (keeps audit history)</label> : null}
        </details>
        <footer><button type="button" disabled={saving} onClick={onCancel}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving…" : use ? "Mark used" : "Save award"}</button></footer>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </section>
  </dialog>;
}

export function FreeNightAwards({ benefit, asOf, onSave }: {
  benefit: FreeNightBenefit; asOf: string; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const awards = benefit.awards || [];
  const live = awards.filter(award => award.status === "available");
  const missingDates = awards.filter(award => award.status === "unknown_expiry");
  const history = awards.filter(award => award.status === "used" || award.status === "expired");
  function row(award: FreeNightAward) {
    return <div key={award.id} className={`fna-award is-${award.status}`}>
      <div><strong>{award.label}</strong><small>{award.status === "used" ? `Used ${award.used_on || `in ${award.used_year} (${award.used_year_confidence === "estimated" ? "year estimated; " : ""}date unknown)`} · ${money.format(award.value_usd)} counted` : award.status === "expired" ? `Expired ${award.expires_on} · $0 counted` : award.status === "unknown_expiry" ? "Expiry date needed · $0 counted" : award.expires_on ? `${award.days_remaining} days left · expires ${award.expires_on} · not yet counted` : "No expiration · counted in year issued"}</small>{award.note ? <small>{award.note}</small> : null}</div>
      <span>{money.format(award.value_usd)} {award.value_basis === "user_override" ? "recorded" : "est."}</span>
      <div className="fna-actions">{award.status === "available" ? <button type="button" className="fna-use" onClick={() => setEditor({ mode: "use", award })}>Use free night</button> : null}<button type="button" onClick={() => setEditor({ mode: "edit", award })}>{award.status === "expired" ? "Edit / log past stay" : "Edit"}</button></div>
    </div>;
  }
  return <section className="fna-panel" aria-label={benefit.title}>
    <header><div><span className="fna-kicker">Free-night award</span><h4>{benefit.title}</h4></div><div className="fna-summary"><strong title={benefit.valuation_basis || undefined}>{money.format(benefit.catalog_value_usd || 0)} estimated / night</strong><small>{live.length} available · separate from credit balances</small></div></header>
    <p className="fna-muted">{benefit.certificate_policy?.expires ? `${benefit.certificate_policy.expiry_months} months from issuance · counts only when used` : "No expiration · counts when issued"}{benefit.valuation_source_url ? <> · <a href={benefit.valuation_source_url} target="_blank" rel="noreferrer">Valuation ↗</a></> : null}</p>
    {benefit.next_anniversary_on ? <p className="fna-muted">Next card anniversary: {benefit.next_anniversary_on}. Award issuance can follow later; this is not an expiry date.</p> : null}
    {live.map(row)}
    {missingDates.map(row)}
    {!awards.length ? <p className="fna-muted">No awards recorded. Issuance, expiry and use are not inferred from your card anniversary.</p> : null}
    <button type="button" className="fna-add" onClick={() => setEditor({ mode: "add" })}>Add award</button>
    {history.length ? <details className="fna-history"><summary>Used &amp; expired awards ({history.length})</summary>{history.map(row)}</details> : null}
    <details className="fna-terms"><summary>Expiry &amp; redemption terms</summary><p>{benefit.certificate_policy?.rule}</p>{benefit.certificate_policy?.source_url ? <a href={benefit.certificate_policy.source_url} target="_blank" rel="noreferrer">Issuer terms ↗</a> : null}</details>
    {editor ? <AwardDialog editor={editor} benefit={benefit} asOf={asOf} onSave={onSave} onCancel={() => setEditor(null)} /> : null}
  </section>;
}
