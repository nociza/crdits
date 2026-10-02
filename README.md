# crdits

`crdits` is a local-first credit-card value ledger. It tracks recurring credits, targeted offers, actual usage, sourced catalog value, annual-fee ROI, reward categories, point values, and which owned card should be used for a purchase.

The project deliberately has two sources of truth:

- `catalog/cards/*.json` is the public, versioned, community-maintained card catalog.
- `.data/crdits.sqlite` is the private wallet, usage, optional overrides, offer, and reminder ledger.

Full card numbers, issuer credentials, MFA data, cookies, and browser sessions are never part of the model.

## Start

Node.js 24 or newer is recommended because `crdits` uses the built-in SQLite module.

```bash
npm ci
npm run crdits -- catalog import-csv /path/to/cards.csv
npm run crdits -- wallet import-csv /path/to/cards.csv
npm run dev
```

The web dashboard and loopback API start together. The default API is `127.0.0.1:8788`; the web URL is printed by the development server.

The attached starter data used for this repository produced the initial public catalog. Wallet ownership is not committed: import the CSV locally to populate SQLite.

## Everyday commands

```bash
npm run crdits -- summary
npm run crdits -- due --days 14
npm run crdits -- recommend dining --amount 85 --merchant "Local restaurant"
npm run crdits -- use --card "Amex Hilton Aspire" --benefit flight-credit --amount 35
npm run crdits -- benefit activate --card "Sapphire Preferred" --benefit dashpass
npm run crdits -- wallet update --card "Sapphire Preferred" --membership-year-start 2026-06-01
```

Machine-readable output is available with `--json`. The dashboard uses the same service layer as the CLI, so calculations do not diverge between the website and Teleclaw.

Click an elapsed month, quarter, or half-year to **set its used total**, including
fully used periods. The one-field dialog accepts 0 for a correction and shows an
audit trail. The year selector opens older bookkeeping. Additional `use` entries
are capped; `set-used --previous OLD --amount NEW --request-id UNIQUE_ID` is
duplicate-safe and rejects stale totals. `history --card ID --benefit ID` returns
the correction trail. Original entries are retained, and anniversary corrections
preserve their allocation across calendar years.

Spend-to-earn offers distinguish purchase spending from the statement credit
received. Marriott's airline offer requires **$250 spent directly with airlines
per window to earn $50**. Log the credit received, never the airline ticket
amount. The catalog publishes both Chase eligibility cohorts; the wallet's
chosen timeline is private in SQLite. Open **Offer terms & timeline** to choose
the schedule shown on your account. Finite offers show their exact date ranges,
including a next-year window, and never recur after the promotion ends. Changing
the schedule preserves existing usage dates and values and counts only one
cohort. A future-year window is displayed but is not added to this year's total.

“Net value this year” means used/credited value minus annual fees. Remaining
this year includes future reset periods and is not an available-now balance.
New ledger entries store their valuation ratio; legacy entries are pinned once
at migration-time catalog values, not asserted historical redemption prices.
Historical fees and benefits remain limited by the definitions actually recorded
in the catalog; the seed does not invent pre-2026 entitlement history.

Recommendations enforce structured category, merchant and channel constraints.
Unconfirmed bonuses appear separately. `--context` can provide a booking channel,
confirmed rule IDs and **remaining** caps; beyond-cap spend falls back to base
earn. Bilt's 3.33X strategy is retained conditionally, with 2X base earn when its
housing-linked capacity is unknown. See the skill command reference for fields.

Catalog forms load existing IDs and valuations, preview changes, and save a
local public-catalog patch. A local save is not a Git push: publication remains
an explicit reviewed repository operation. Used/archived offers leave the active
recommendation and reminder set and can be edited or restored from history.

## Agent skill

Install the repository skill into Codex and Claude Code with a safe symlink:

```bash
npm run skill:install
```

Use `-- --codex`, `-- --claude`, or `-- --all` to choose targets explicitly. The installer refuses to replace an existing non-symlink skill. After installation, ask naturally:

- “What credits expire this month?”
- “I used $35 of my Aspire flight credit today.”
- “Which card should I use for groceries?”
- “The Sapphire hotel credit changed; update it from this issuer page.”

The skill is in [`skills/crdits`](skills/crdits/SKILL.md).

Catalog contributions are welcome through
[`nociza/crdits`](https://github.com/nociza/crdits). See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the public/private data boundary.

## Teleclaw

The safe reminder poll is:

```bash
npm run teleclaw:poll
```

Run it daily from Teleclaw's existing gateway scheduler. It fetches the private reminder endpoint, prints one grouped message only when actionable state changes, and otherwise prints `NO_REPLY`. Configure `CRDITS_REMINDERS_URL`, `CRDITS_API_TOKEN_FILE`, and optionally `CRDITS_REMINDERS_DAYS` in host-local protected runtime settings—not Git. The low-frequency catalog review queue is:

The same checkout can answer interactive wallet questions without creating a
second SQLite database: set `CRDITS_API_URL` and `CRDITS_API_TOKEN_FILE`, and
the CLI routes wallet reads and writes to the authenticated service while
keeping public `catalog` mutations local for review and Git publication.

```bash
npm run catalog:refresh-plan
```

Run that monthly as an agent task. Teleclaw should verify official issuer sources, write structured catalog updates, run `npm run catalog:validate`, and report the Git diff. It must never query issuer accounts or place targeted offers in Git. The job definition and Telegram destination stay host-local. See [`skills/crdits/references/teleclaw.md`](skills/crdits/references/teleclaw.md).

## Catalog updates

Catalog definitions have effective dates, valuation methods, values, and sources. Dollar credits use the issuer's stated maximum per period. Point bonuses use a dated cents-per-point estimate, with the editorial source clearly labeled. Entitlements that should not offset the annual fee use an explicit zero-dollar `excluded` valuation. The seed importer keeps the research timestamp in `verified_at` and uses the start of that calendar year as the history floor for imported benefits; it does not pretend the day of research was the day every recurring credit began. Structured update commands use explicit effective dates and archive a replaced definition in the card's `history` before writing the new version.

```bash
npm run crdits -- catalog upsert-benefit \
  --card chase-sapphire-preferred \
  --title "Hotel credit" \
  --amount-usd 100 \
  --valuation-method face_value \
  --valuation-value-usd 100 \
  --valuation-basis "Issuer-stated maximum per anniversary year" \
  --cadence anniversary \
  --valid-from 2026-06-23 \
  --valuation-as-of 2026-06-23 \
  --source-url https://issuer.example/card-terms

npm run crdits -- catalog upsert-reward \
  --card chase-freedom-flex \
  --category groceries \
  --rate 5 \
  --rate-type points_multiplier \
  --match-terms "grocery, supermarkets" \
  --valid-from 2026-10-01 \
  --source-url https://issuer.example/quarterly-calendar
```

The dashboard provides the same structured writer. Review and commit its catalog diff through the normal Git workflow.

Each catalog benefit declares how it behaves: `spend` for finite credits, `automatic` for issuer-applied bonuses and included statuses, `enrollment` for activate-once memberships, or `reference` for informational perks. Only spend benefits create usage-ledger entries. Membership-year anchors remain private and drive true anniversary windows and annual-fee countdowns.

Monthly, quarterly, and semiannual spend credits are displayed as separate Jan–Dec, Q1–Q4, or H1–H2 periods, including expired, current, used, and upcoming states. Select any available current or closed period tile, enter the amount in the one-field popup, and save; the current period uses today's date while retrospective entries use that period's closing date. Usage is applied only to its named, dated period and never carries across a reset boundary; future and fully used periods are disabled.

Memberships, lounge access, hotel status, and elite-night credits are tracked as entitlements but carry an explicit catalog value of $0 and never reduce the annual fee. Automatic point currency, such as anniversary miles, is valued only when the catalog has both a points amount and a dated point valuation. Free-night certificates remain visible but excluded until the catalog has a defensible, source-backed valuation policy for that certificate.

Venture X's automatic 10,000 anniversary miles use the $100 fixed travel-redemption value for annual-fee accounting. A benefit can provide `valuation.point_value_cents` for this purpose while the card's transfer-partner estimate remains available for purchase recommendations. Without an anniversary date, annual automatic point grants are recognized once in the selected year; their exact award date is unknown. A known opening date enforces any `minimum_membership_years` requirement. Spend-credit balances and expirations require the real anniversary: **Log use** asks for the current membership-year start once, saves it privately, and then records the amount. The $300 Capital One Travel credit is capped per anniversary period and can be logged across multiple bookings. Annual credit popups accept an **amount used now**, adding it to prior usage, or **Use full remaining credit** to close the balance in one click. Correction history provides a separate total-replacement mode, including zero to clear a mistaken entry. These writes retain the existing concurrency checks, request deduplication and private audit trail.

## Expected value

No valuation setup is required for a normal wallet. For each current or future benefit cycle in the calendar year:

```text
expected value = sourced catalog value × remaining balance share
realized value = sourced catalog value × used balance share
projected net = realized value used this year − annual fees
```

Dollar statement credits default to 100% of issuer-stated face value. Editorial point valuations remain labeled estimates rather than guaranteed cash value. Existing local preference rows remain supported as optional advanced overrides, while targeted offers stay separate and are never added automatically to expected value.

`projected_net_usd` deliberately excludes unused expected value. It answers whether value already realized this year has covered annual fees; remaining credits are reported separately as expected value.

Derived earn rates retain their math and limits in the public catalog. For example, Bilt Palladium's conditional 3.33X catch-all combines 2X base points with 1.33X from 4% Bilt Cash redeemed toward housing points. It applies only under Flexible Bilt Cash while housing unlock capacity remains—about the first 75% of monthly housing spend. Purchase rewards are separate from the coupon/annual-fee tally.

Bilt Cash uses an explicit incremental-value accounting policy, not a claim that it can be withdrawn as unrestricted cash. Its rounded points baseline is $0.33 per nominal dollar; eligible cash/hotel redemptions deliver $1 gross. Normal rewards are excluded from the coupon tally, so cash redemption adds only $1 − $0.33 = **$0.67 per dollar** toward the annual fee. The annual $200 allocation contributes **$134 only when redeemed as cash**; points redemption consumes the same balance but contributes $0 beyond the already-accounted rewards baseline. Unused value projects the cash route and remains labeled maximum incremental value, not already realized value. The separate $400 hotel benefit is not revalued or consumed by Bilt Cash usage.

The Bilt Cash popup asks **Redeemed as: Cash / eligible hotel credit or Points**. Mixed redemptions keep each entry's method and counted value. Corrections default to preserving prior methods and dates; choosing a method in correction mode reclassifies that period's entire total, retaining retired rows and before/after counted values in the private audit trail. Teleclaw/CLI uses `use --redemption-method cash|points`; explicit reclassification uses `set-used --redemption-method cash|points --revalue-existing --previous-value OLD_COUNTED_VALUE` with the usual prior total and unique request ID. Both stale amounts and stale valuations are rejected. Rules remain public Git data; amounts, dates, choices and correction history stay private SQLite.

## Private deployment

`crdits` is intended to run as a separate service boundary, even when linked from an existing dashboard. Use a dedicated service account, local SQLite path, API credential, port, and systemd sandbox. A trusted small-app guest may be shared, but SQLite must never be opened over a network mount. Keep the catalog and client-side encrypted database backups separate, and place external browser access behind its own Access policy.

```bash
docker compose up --build
```

The compose file binds the web app to `127.0.0.1:3010` and persists SQLite in the `crdits-data` volume. Mounting `./catalog` keeps website or agent catalog changes visible to Git. See [`docs/dashboard-integration.md`](docs/dashboard-integration.md) for the existing dashboard boundary.

For a Tailscale-only systemd deployment in a dedicated unprivileged guest, see
[`docs/dedicated-service.md`](docs/dedicated-service.md). The API supports
`CRDITS_API_TOKEN_FILE` so production tokens do not need to appear in a unit or
repository.

## Quality gates

```bash
npm run check
```

Automatic anniversary grants offset the active membership year's annual fee once, even when its start was in the previous calendar year. They do not become spend-ledger entries, and renewal never counts both the old and new grant together. Calendar-based grants retain their calendar-year behavior; known opening dates still enforce first-anniversary eligibility.

Tests cover catalog import, recurring and anniversary cycles, automatic and enrollment behavior, partial usage, expected value, recommendations, SQLite isolation, and the server-rendered application shell.

## License

MIT
