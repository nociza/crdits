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
- Expiring credits or renewals: `crdits due --days 30 --json`
- Best card: `crdits recommend dining --amount 80 --merchant "Restaurant" --json`
- Wallet inventory: `crdits wallet list --json`

State the point-value assumption when it changes the recommendation. Do not describe editorial point values as guaranteed cash value.

## Record private activity

First inspect the benefit's `tracking_type` in `crdits summary --json`. Its behavior is deterministic:

- `spend`: a finite credit or balance. Confirm the card, benefit, amount, and date, then record usage.
- `automatic`: an issuer-applied bonus or included status. Never ask the user to log it and never write usage. Count only explicit point currency with a catalog point valuation; never let lounge access, memberships, elite-night credits, or status offset an annual fee automatically.
- `enrollment`: a one-time activation such as DashPass or Priority Pass. Mark it active once; the state persists.
- `reference`: an informational or conditional perk. Do not invent a usage balance.

Record only spend benefits with:

```text
crdits use --card CARD --benefit BENEFIT_ID --amount USD --date YYYY-MM-DD --note TEXT
```

Quarterly and semiannual credits are independent reset periods. Before recording one, inspect `summary --json`, find the benefit's current `periods` entry, and ensure the usage date falls between that entry's `start` and `end`. Never carry usage into a prior, future, or newly reset period. If the user names a past period such as H1 or Q2 but does not know the exact date, use that period's end date only after explicitly noting that it is a period-end marker rather than a known transaction date.

For a confirmed one-time enrollment, run:

```text
crdits benefit activate --card CARD --benefit BENEFIT_ID --date YYYY-MM-DD --note TEXT
```

When a benefit or fee follows an account-anniversary year, use the annual-fee/opening record to set its anchor:

```text
crdits wallet update --card CARD --membership-year-start YYYY-MM-DD
```

Do not substitute a calendar-year countdown when the membership-year date is unknown. Report that the date is needed.

Activation is state, not value. Marking DashPass, Priority Pass, or a status active must not add realized or expected dollars. Do not assign a cash value to a service or status unless a future user explicitly asks for a separate manual valuation feature.

Add targeted issuer offers with `crdits offer add`. Keep merchant offers, activation state, card nicknames, last four digits, usage, and notes in SQLite. Never place them in `catalog/`.

Do not request or store full card numbers, issuer credentials, MFA data, session cookies, or transaction descriptions.

## Update public card facts

Use an official issuer page first. Record the source URL and effective date. Choose one structured mutation:

- Credit or benefit: `catalog upsert-benefit` with an explicit `tracking_type`
- Reward category or multiplier: `catalog upsert-reward`
- Annual fee or point valuation: `catalog patch-card`

The CLI archives a replaced definition in the card's `history` before writing the new version. After any catalog mutation:

1. Run `crdits catalog validate --json`.
2. Inspect the Git diff for only the intended `catalog/cards/*.json` change.
3. Report the source, effective date, and changed fields.
4. Commit only when the user's workflow explicitly authorizes a commit.

Do not treat targeted offers or a user's preferences as community facts.

## Teleclaw routines

Use `npm run teleclaw:poll` for the daily reminder job. It reads the authenticated private reminder endpoint, retains only a local state fingerprint, groups changed reminders, and prints `NO_REPLY` for empty or unchanged state. Keep its endpoint token, scheduler definition, and Telegram target in protected host-local configuration.

Use `npm run catalog:refresh-plan` for the low-frequency public catalog review queue. Research only entries returned by that command. See [teleclaw.md](references/teleclaw.md) for suggested schedules and response rules.

Read [commands.md](references/commands.md) for command fields and [catalog.md](references/catalog.md) before handling ambiguous versioning or privacy questions.
