#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_REMINDERS = 32;
const DEFAULT_URL = "http://127.0.0.1:8788/v1/reminders";

function boundedString(value, field, maxLength = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`invalid ${field}`);
  }
  return value.trim();
}

function nullableMoney(value, field) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new Error(`invalid ${field}`);
  }
  return Math.round(value * 100) / 100;
}

export function validateReminderPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid reminder response");
  const asOf = boundedString(value.as_of, "as_of", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("invalid as_of");
  if (!Array.isArray(value.reminders) || value.reminders.length > MAX_REMINDERS) {
    throw new Error("invalid reminders");
  }

  const reminders = value.reminders.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`invalid reminder ${index}`);
    const expiresOn = boundedString(item.expires_on, `reminders[${index}].expires_on`, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new Error(`invalid reminder ${index} expiration`);
    const type = boundedString(item.type, `reminders[${index}].type`, 24);
    const severity = boundedString(item.severity, `reminders[${index}].severity`, 16);
    if (!new Set(["benefit", "offer", "annual_fee"]).has(type)) throw new Error(`invalid reminder ${index} type`);
    if (!new Set(["urgent", "upcoming"]).has(severity)) throw new Error(`invalid reminder ${index} severity`);
    return {
      type,
      severity,
      card_name: boundedString(item.card_name, `reminders[${index}].card_name`, 120),
      title: boundedString(item.title, `reminders[${index}].title`, 180),
      detail: boundedString(item.detail, `reminders[${index}].detail`, 180),
      expires_on: expiresOn,
      remaining_usd: nullableMoney(item.remaining_usd, `reminders[${index}].remaining_usd`),
      benefit_id: item.benefit_id == null ? null : boundedString(item.benefit_id, `reminders[${index}].benefit_id`, 100),
      offer_id: item.offer_id == null ? null : boundedString(String(item.offer_id), `reminders[${index}].offer_id`, 100),
    };
  });
  return { as_of: asOf, reminders };
}

export function reminderFingerprint(payload) {
  const stable = payload.reminders
    .map((item) => ({
      type: item.type,
      card_name: item.card_name,
      id: item.benefit_id || item.offer_id || item.title.replace(/\d+ day(s)?/g, "days"),
      expires_on: item.expires_on,
      remaining_usd: item.remaining_usd,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function formatReminderMessage(payload) {
  const ordered = [...payload.reminders].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "urgent" ? -1 : 1;
    return a.expires_on.localeCompare(b.expires_on);
  });
  const lines = [`crdits — ${ordered.length} credit${ordered.length === 1 ? "" : "s"} to review`];
  for (const item of ordered) {
    const marker = item.severity === "urgent" ? "URGENT" : "Soon";
    lines.push(`${marker}: ${item.card_name} — ${item.title} (${item.detail}; ${item.expires_on})`);
  }
  return lines.join("\n");
}

async function readJsonBounded(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("reminder response too large");
  const reader = response.body?.getReader();
  if (!reader) return JSON.parse(await response.text());
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("reminder response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function priorFingerprint(statePath) {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    return typeof state.fingerprint === "string" ? state.fingerprint : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function saveState(statePath, state) {
  const stateDir = path.dirname(statePath);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, statePath);
  await chmod(statePath, 0o600);
}

async function resolveToken(token, tokenFile) {
  if (token) return token;
  if (!tokenFile) return null;
  const value = (await readFile(tokenFile, "utf8")).trim();
  if (!value || value.length > 4096) throw new Error("invalid CRDITS_API_TOKEN_FILE");
  return value;
}

export async function pollReminders({
  url = process.env.CRDITS_REMINDERS_URL || DEFAULT_URL,
  token = process.env.CRDITS_API_TOKEN || null,
  tokenFile = process.env.CRDITS_API_TOKEN_FILE || null,
  days = Number(process.env.CRDITS_REMINDERS_DAYS || 14),
  statePath = process.env.CRDITS_REMINDER_STATE_PATH || path.join(homedir(), ".local", "state", "crdits-reminders", "state.json"),
  fetchImpl = fetch,
} = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("CRDITS_REMINDERS_DAYS must be between 1 and 365");
  const endpoint = new URL(url);
  if (!new Set(["http:", "https:"]).has(endpoint.protocol)) throw new Error("CRDITS_REMINDERS_URL must use http or https");
  endpoint.searchParams.set("days", String(days));
  const resolvedToken = await resolveToken(token, tokenFile);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: resolvedToken ? { authorization: `Bearer ${resolvedToken}`, accept: "application/json" } : { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`crdits reminder endpoint returned ${response.status}`);

  const payload = validateReminderPayload(await readJsonBounded(response));
  const fingerprint = reminderFingerprint(payload);
  const previous = await priorFingerprint(statePath);
  await saveState(statePath, { fingerprint, as_of: payload.as_of, checked_at: new Date().toISOString() });
  if (!payload.reminders.length || fingerprint === previous) return "NO_REPLY";
  return formatReminderMessage(payload);
}

async function main() {
  try {
    console.log(await pollReminders());
  } catch (error) {
    console.error(`crdits reminder poll failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
