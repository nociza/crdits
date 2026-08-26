import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { pollReminders, validateReminderPayload } from "../integrations/teleclaw/crdits-reminders.mjs";

function payload(reminders = []) {
  return {
    as_of: "2026-08-26",
    days: 14,
    reminders,
  };
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const urgent = {
  type: "benefit",
  severity: "urgent",
  wallet_card_id: 1,
  card_name: "Example Card",
  benefit_id: "rideshare-credit",
  title: "Rideshare credit expires in 4 days",
  detail: "$10 remaining",
  expires_on: "2026-08-31",
  remaining_usd: 10,
};

test("poller emits the first actionable state then suppresses it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crdits-teleclaw-"));
  const statePath = path.join(directory, "state", "state.json");
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return response(payload([urgent]));
  };

  const first = await pollReminders({ url: "https://crdits.example/v1/reminders", token: "test-token", statePath, fetchImpl });
  const second = await pollReminders({ url: "https://crdits.example/v1/reminders", token: "test-token", statePath, fetchImpl });

  assert.match(first, /URGENT: Example Card/);
  assert.equal(second, "NO_REPLY");
  assert.match(calls[0].url, /days=14/);
  assert.equal(calls[0].options.headers.authorization, "Bearer test-token");
  assert.equal(typeof JSON.parse(await readFile(statePath, "utf8")).fingerprint, "string");
});

test("relative day wording alone does not repeat an alert", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crdits-teleclaw-"));
  const statePath = path.join(directory, "state.json");
  let title = "Rideshare credit expires in 4 days";
  const fetchImpl = async () => response(payload([{ ...urgent, title }]));
  await pollReminders({ statePath, fetchImpl });
  title = "Rideshare credit expires in 3 days";
  assert.equal(await pollReminders({ statePath, fetchImpl }), "NO_REPLY");
});

test("empty reminders are silent and invalid fields are rejected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crdits-teleclaw-"));
  assert.equal(await pollReminders({ statePath: path.join(directory, "state.json"), fetchImpl: async () => response(payload()) }), "NO_REPLY");
  assert.throws(() => validateReminderPayload(payload([{ ...urgent, card_name: "" }])), /card_name/);
});

test("endpoint errors fail closed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crdits-teleclaw-"));
  await assert.rejects(
    pollReminders({ statePath: path.join(directory, "state.json"), fetchImpl: async () => response({ error: "no" }, 401) }),
    /returned 401/,
  );
});
