import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("CLI passes cash/points and audited reclassification fields to the shared service", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crdits-cli-bilt-"));
  const cli = fileURLToPath(new URL("../bin/crdits.mjs", import.meta.url));
  const env = { ...process.env, CRDITS_API_URL: "", CRDITS_DB_PATH: path.join(directory, "test.sqlite") };
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--json"], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    const wallet = run("wallet", "add", "--catalog-slug", "bilt-palladium-card", "--membership-year-start", "2026-01-01");
    const common = ["--card", String(wallet.id), "--benefit", "bilt-cash-annually", "--date", "2026-08-28"];
    run("use", ...common, "--amount", "100", "--redemption-method", "points");
    run("use", ...common, "--amount", "100", "--redemption-method", "cash");
    assert.equal(run("summary").cards[0].logged_realized_ytd_usd, 67);
    run("set-used", ...common, "--amount", "200", "--previous", "200", "--previous-value", "67", "--redemption-method", "cash", "--revalue-existing", "--request-id", "cli-bilt-reclassification");
    assert.equal(run("summary").cards[0].logged_realized_ytd_usd, 134);
    assert.equal(run("history", "--card", String(wallet.id), "--benefit", "bilt-cash-annually")[0].after_value_usd, 134);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI records private free nights with unknown issuance and preserves default value on use", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crdits-cli-awards-"));
  const cli = fileURLToPath(new URL("../bin/crdits.mjs", import.meta.url));
  const env = { ...process.env, CRDITS_API_URL: "", CRDITS_DB_PATH: path.join(directory, "test.sqlite") };
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--json"], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    const wallet = run("wallet", "add", "--catalog-slug", "marriott-bonvoy-boundless-credit-card", "--membership-year-start", "2026-01-01");
    const base = ["--card", String(wallet.id), "--benefit", "earned-50k-free-night-awards"];
    const award = run("award", "save", ...base, "--expires-on", "2027-06-01", "--request-id", "cli-issued-award-example");
    assert.equal(award.issued_on, null);
    assert.equal(award.value_usd, 274);
    assert.equal(run("summary").cards[0].award_realized_ytd_usd, 0);
    const used = run("award", "save", ...base, "--id", String(award.id), "--previous-revision", "1", "--used-on", "2026-07-08", "--request-id", "cli-used-award-example");
    assert.equal(used.value_usd, 274);
    assert.equal(run("summary").cards[0].award_realized_ytd_usd, 274);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
