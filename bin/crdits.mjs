#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createApiClient } from "../integrations/client.mjs";
import { createService } from "../server/service.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let localService;
function local() {
  localService ??= createService({ root });
  return localService;
}
const wallet = process.env.CRDITS_API_URL ? createApiClient() : local();

function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) flags[name] = inline;
    else if (args[index + 1] && !args[index + 1].startsWith("--")) flags[name] = args[++index];
    else flags[name] = true;
  }
  return { positionals, flags };
}

function inputFromFlags(flags) {
  return Object.fromEntries(Object.entries(flags).map(([key, value]) => [key.replaceAll("-", "_"), value]));
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value || 0);
}

function output(value, { json = false } = {}) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

function help() {
  console.log(`crdits — local credit-card value ledger

Usage:
  crdits summary [--json]
  crdits due [--days 30] [--json]
  crdits recommend <category> [--merchant NAME] [--amount 100] [--json]
  crdits use --card ID_OR_SLUG --benefit ID --amount USD [--date YYYY-MM-DD] [--note TEXT]
  crdits offer add --card ID_OR_SLUG --merchant NAME --title TEXT [--reward-amount USD] [--expires YYYY-MM-DD] [--activated]
  crdits wallet list [--json]
  crdits wallet add --catalog-slug SLUG [--nickname NAME] [--last-four 1234]
  crdits wallet import-csv PATH
  crdits catalog import-csv PATH
  crdits catalog validate [--json]
  crdits catalog stale [--days 45] [--json]
  crdits catalog upsert-benefit --card SLUG --title TITLE --amount-usd USD --cadence monthly|quarterly|semiannual|annual|anniversary
  crdits catalog upsert-reward --card SLUG --category CATEGORY --rate N --rate-type points_multiplier|cashback_percent
  crdits catalog patch-card --card SLUG [--annual-fee-usd USD] [--point-value-cents CPP]
`);
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const [command, subcommand, ...rest] = positionals;
  const json = Boolean(flags.json);

  if (!command || command === "help" || flags.help) return help();

  if (command === "summary") {
    const dashboard = await wallet.dashboard();
    if (json) return output(dashboard, { json });
    console.log(`As of ${dashboard.as_of}`);
    console.log(`Realized YTD:       ${money(dashboard.metrics.realized_ytd_usd)}`);
    console.log(`Credits remaining:  ${money(dashboard.metrics.credits_remaining_usd)}`);
    console.log(`Expected remaining: ${money(dashboard.metrics.expected_remaining_usd)}`);
    console.log(`Annual fees:        ${money(dashboard.metrics.annual_fees_usd)}`);
    console.log(`Projected net:      ${money(dashboard.metrics.projected_net_usd)}`);
    return;
  }

  if (command === "due") {
    const result = await wallet.reminders(flags.days || 30);
    if (json) return output(result, { json });
    if (!result.reminders.length) return console.log(`No credits or renewals due in the next ${result.days} days.`);
    for (const item of result.reminders) console.log(`${item.expires_on}  ${item.title} — ${item.detail}`);
    return;
  }

  if (command === "recommend") {
    const category = subcommand || flags.category || "";
    const result = await wallet.recommend({ category, merchant: flags.merchant || "", amount: flags.amount || 100 });
    if (json) return output(result, { json });
    const best = result.recommendation[0];
    if (!best) return console.log("Add an active card to your wallet first.");
    console.log(`${best.nickname}${best.last_four ? ` •${best.last_four}` : ""}`);
    console.log(`${best.rule} · estimated value ${money(best.total_value_usd)} on ${money(result.amount_usd)}`);
    return;
  }

  if (command === "use") {
    const item = await wallet.addUsage({
      card: flags.card,
      benefit_id: flags.benefit,
      amount_usd: flags.amount,
      used_at: flags.date,
      note: flags.note,
    });
    return output(json ? item : `Recorded ${money(item.amount_usd)} of ${item.benefit_id} on ${item.used_at}.`, { json });
  }

  if (command === "offer" && subcommand === "add") {
    const item = await wallet.addOffer({
      card: flags.card,
      merchant: flags.merchant,
      title: flags.title,
      spend_requirement_usd: flags["spend-requirement"],
      reward_amount_usd: flags["reward-amount"],
      reward_percent: flags["reward-percent"],
      expires_on: flags.expires,
      activated: Boolean(flags.activated),
      source: flags.source,
      note: flags.note,
    });
    return output(json ? item : `Added ${item.merchant}: ${item.title}`, { json });
  }

  if (command === "wallet" && subcommand === "list") {
    const cards = await wallet.walletCards();
    if (json) return output(cards, { json });
    for (const card of cards) console.log(`${card.id}  ${card.nickname}  ${card.catalog_slug}  ${card.status}`);
    return;
  }

  if (command === "wallet" && subcommand === "add") {
    const item = await wallet.addWalletCard({
      catalog_slug: flags["catalog-slug"] || rest[0],
      nickname: flags.nickname,
      last_four: flags["last-four"],
      opened_on: flags["opened-on"],
      renewal_date: flags["renewal-date"],
      annual_fee_override: flags["annual-fee-override"],
    });
    return output(json ? item : `Added ${item.nickname}.`, { json });
  }

  if (command === "wallet" && subcommand === "import-csv") {
    const file = rest[0] || flags.file;
    if (!file) throw new Error("CSV path is required");
    if (process.env.CRDITS_API_URL) throw new Error("wallet CSV import must run on the database host");
    const cards = await local().importWalletCsv(file);
    return output(json ? cards : `Imported ${cards.length} wallet cards into local SQLite.`, { json });
  }

  if (command === "catalog" && subcommand === "import-csv") {
    const file = rest[0] || flags.file;
    if (!file) throw new Error("CSV path is required");
    const cards = await local().importCatalogCsv(file);
    return output(json ? cards : `Wrote ${cards.length} versioned catalog cards.`, { json });
  }

  if (command === "catalog" && subcommand === "validate") {
    const result = await local().validateCatalog();
    if (!result.valid) process.exitCode = 1;
    return output(json ? result : `${result.valid ? "Valid" : "Invalid"}: ${result.cards} catalog cards checked.`, { json });
  }

  if (command === "catalog" && subcommand === "stale") {
    const cards = await local().staleCatalog(flags.days || 45);
    if (json) return output(cards, { json });
    for (const card of cards) console.log(`${card.slug}  ${card.verification_status}  ${card.verified_at || "never"}`);
    return;
  }

  if (command === "catalog" && subcommand === "upsert-benefit") {
    const input = inputFromFlags(flags);
    const card = await local().upsertBenefit(flags.card, input);
    return output(json ? card : `Updated ${input.title} on ${card.name}.`, { json });
  }

  if (command === "catalog" && subcommand === "upsert-reward") {
    const input = inputFromFlags(flags);
    const card = await local().upsertRewardRule(flags.card, input);
    return output(json ? card : `Updated ${input.category} rewards on ${card.name}.`, { json });
  }

  if (command === "catalog" && subcommand === "patch-card") {
    const input = inputFromFlags(flags);
    const card = await local().patchCardFacts(flags.card, input);
    return output(json ? card : `Updated facts for ${card.name}.`, { json });
  }

  throw new Error(`Unknown command: ${positionals.join(" ")}`);
}

main().catch((error) => {
  console.error(`crdits: ${error.message}`);
  process.exitCode = 1;
}).finally(() => localService?.db.close());
