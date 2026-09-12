---
name: crdits
description: Manage a local credit-card wallet, track recurring credits and targeted offers, record usage, calculate realistic card value, identify expiring benefits, recommend the best owned card for a purchase, and maintain the versioned public card catalog. Use when the user asks about their card benefits, remaining credits, reminders, annual-fee value, reward multipliers, point values, which card to use, or when they report a card-rule update that should persist in the crdits repository.
---

# crdits

Use the deterministic `crdits` CLI for wallet state and calculations. Treat the repository catalog as public data and the SQLite wallet as private data. When `CRDITS_API_URL` and `CRDITS_API_TOKEN_FILE` are configured, wallet reads and writes go to that authenticated service while catalog commands continue to edit the local Git checkout.

## Locate the CLI

Prefer an installed `crdits` command. Otherwise use `node "$CRDITS_HOME/bin/crdits.mjs"`. When `CRDITS_HOME` is unset and this skill remains inside the repository, resolve the repository two directories above this skill.

Never guess a database path. Honor `CRDITS_DB_PATH` when set; otherwise let the CLI use `.data/crdits.sqlite` inside the repository.

## Answer wallet questions

Run the narrowest JSON command, then explain the result plainly:

- Portfolio value or card ROI: `crdits summary --json`
- Past-year bookkeeping: `crdits summary --year YYYY --json`
- Expiring credits or renewals: `crdits due --days 30 --json`
- Best card: `crdits recommend dining --amount 80 --merchant "Restaurant" --json`
- Wallet inventory: `crdits wallet list --json`

State the dated point-value assumption and source when it changes the recommendation. Do not describe editorial point values as guaranteed cash value. Normal wallet summaries use the public catalog valuation automatically; never ask the user to assign a value to each credit.

Recommendations separate unconditional earn from `conditional_alternatives`. A merchant name alone does not confirm eligibility. Read [commands.md](references/commands.md) for rule confirmation, booking channel and remaining-cap context. Ask only for missing constraints that could change the answer; never assume activation, partner eligibility or unused capacity.

For Bilt Palladium catch-all recommendations, preserve the catalog's full condition: 3.33X means 2X base points plus 1.33X derived from earning 4% Bilt Cash and redeeming it at $30 per 1,000 housing points. Apply it only under the Flexible Bilt Cash option while housing unlock capacity remains—approximately the first 75% of monthly rent or mortgage in everyday spend. State that cap whenever Bilt wins; do not present 3.33X as unconditional or uncapped.

Treat usage amounts as nominal units but report realized dollars using the same sourced catalog ratio as expected value. For example, using all $200 nominal Bilt Cash realizes $66.67 under the conservative one-third valuation; never convert that ledger entry back to $200 of realized card value.

Define projected net as realized value used in the current year minus annual fees. Never add unused expected credits to projected net; report expected remaining value separately.

## Record private activity

First inspect the benefit's `tracking_type` in `crdits summary --json`. Its behavior is deterministic:

- `spend`: a finite credit or balance. Confirm the card, benefit, amount, and date, then record usage.
- `automatic`: an issuer-applied bonus or included status. Never ask the user to log it and never write usage. Count only explicit point currency with a catalog point valuation; never let lounge access, memberships, elite-night credits, or status offset an annual fee automatically.
- `enrollment`: a one-time activation such as DashPass or Priority Pass. Mark it active once; the state persists.
- `reference`: an informational or conditional perk. Do not invent a usage balance.

Use `use` only for additional spend usage:

```text
crdits use --card CARD --benefit BENEFIT_ID --amount USD --date YYYY-MM-DD --note TEXT
```

For “I used $X in Q2,” corrections, or clearing a mistaken total, read the period's current `used_usd` and use `set-used --previous CURRENT_TOTAL --amount NEW_TOTAL`. Pass a unique `--request-id` for a write and reuse it only when retrying that exact request after an uncertain response. Never retry a conflict by silently changing `--previous`; refresh and reconcile first. See [commands.md](references/commands.md). Corrections retain dated allocations and audit history; 0 clears a total without erasing that history.

Monthly, quarterly, and semiannual credits are independent reset periods. Current and retrospective bookkeeping are both supported. Before recording one, inspect `summary --json`, select the exact current or past `periods` entry, and pass its key with `--period YYYY-MM`, `--period YYYY-QN`, or `--period YYYY-HN`. Ensure `--date` falls between that entry's `start` and `end`; the service rejects mismatched and future periods. Never carry usage across a reset boundary. If the user names a past period such as July, H1, or Q2 but does not know the exact date, use that period's end date only after explicitly noting that it is a period-end bookkeeping marker rather than a known transaction date.

For a confirmed one-time enrollment, run:

```text
crdits benefit activate --card CARD --benefit BENEFIT_ID --date YYYY-MM-DD --note TEXT
```

When a benefit or fee follows an account-anniversary year, use the annual-fee/opening record to set its anchor:

```text
crdits wallet update --card CARD --membership-year-start YYYY-MM-DD
```

Do not substitute a calendar-year countdown when the membership-year date is unknown. Report that the date is needed.

Activation is state, not value. Marking DashPass, Priority Pass, or a status active must not add realized or expected dollars. Respect the catalog's explicit `excluded` valuation for services, statuses, elite-night credits, and currently unvalued certificates.

Add targeted issuer offers with `crdits offer add`. Keep merchant offers, activation state, card nicknames, last four digits, usage, and notes in SQLite. Never place them in `catalog/`.

Do not request or store full card numbers, issuer credentials, MFA data, session cookies, or transaction descriptions.

## Update public card facts

Use an official issuer page first for benefit amount and terms. For points, use a current public valuation methodology such as TPG or a data-driven equivalent, and record that it is an estimate. Record the source URL, effective date, valuation method, value, basis, and valuation date. Choose one structured mutation:

- Credit or benefit: `catalog upsert-benefit` with an explicit `tracking_type`
- Reward category or multiplier: `catalog upsert-reward`
- Annual fee or point valuation: `catalog patch-card`

Assign public valuations consistently:

- finite dollar credit: `face_value` at the issuer-stated maximum per reset period;
- automatic points or miles: `points` at `points_amount × point_value_cents`, sourced and dated;
- lounge membership, subscription, status, elite-night credit, or unsupported certificate: `excluded` at $0;
- another defensible public estimate: `market_estimate`, with a reproducible basis and source.

When a reward multiplier combines currencies, store the component rates, conversion, eligibility condition, cap formula, source, and as-of date. Bilt Cash is a separate non-cash currency: for the conservative housing-points method, value each nominal $1 at one-third dollar using the 1-cent Bilt Points cash floor, even though Bilt advertises separate dollar-for-dollar partner redemptions.

The CLI archives a replaced definition in the card's `history` before writing the new version. After any catalog mutation:

When editing an existing benefit or reward, pass its stable `--id`, especially
when renaming its title. Omitted fields are preserved. Website saves write the
backend's local catalog, while a remote skill's catalog commands edit its own
checkout; reconcile those public changes explicitly before claiming publication.

1. Run `crdits catalog validate --json`.
2. Inspect the Git diff for only the intended `catalog/cards/*.json` change.
3. Report the source, effective date, and changed fields.
4. Commit only when the user's workflow explicitly authorizes a commit.

Do not treat targeted offers or a user's preferences as community facts. Keep optional personal overrides in SQLite; never require them for ordinary valuation.

## Teleclaw routines

Use `npm run teleclaw:poll` for the daily reminder job. It reads the authenticated private reminder endpoint, retains only a local state fingerprint, groups changed reminders, and prints `NO_REPLY` for empty or unchanged state. Keep its endpoint token, scheduler definition, and Telegram target in protected host-local configuration.

Use `npm run catalog:refresh-plan` for the low-frequency public catalog review queue. Research only entries returned by that command. See [teleclaw.md](references/teleclaw.md) for suggested schedules and response rules.

Read [commands.md](references/commands.md) for command fields and [catalog.md](references/catalog.md) before handling ambiguous versioning or privacy questions.
