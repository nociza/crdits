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

Period evidence is separate from money. A month can carry a private **likely
used** or **not used** assessment and its supporting notes, without inventing a
credit. Likely use is labeled **Not counted**; only explicit ledger amounts
affect net value. Open a period to read its evidence and confirm or correct the
amount. Public card definitions and generic evidence-handling code may be
shared; personal receipts, assessments, card identifiers and history remain
only in SQLite. The authenticated `POST /v1/usage/evidence` endpoint requires
the exact period, a bounded note, an idempotency request ID, and the expected
recorded total, and cannot silently clear existing usage.

“Net value this year” means used/credited value minus annual fees. Remaining
this year includes future reset periods and is not an available-now balance.
Priority Pass, CLEAR and Global Entry/TSA PreCheck are excluded from net,
potential value, annual remaining and available-now totals. Their individual
benefit balances and usage history remain trackable without contributing value.
Each wallet card keeps these benefits in a collapsed **Show entry perks**
section. Expand it to view or edit their history; collapse it again with
**Hide entry perks**. They do not inflate available-credit badges or promote
an otherwise quiet card into the main wallet list.
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

Each catalog benefit declares how it behaves: `spend` for finite credits, `award` for individual free-night certificates, `automatic` for issuer-applied bonuses and included statuses, `enrollment` for activate-once memberships, or `reference` for informational perks. Only spend benefits create usage-ledger entries. Awards use separate private issuance/redemption records. Membership-year anchors remain private and drive true anniversary windows and annual-fee countdowns.

Monthly, quarterly, and semiannual spend credits are displayed as separate Jan–Dec, Q1–Q4, or H1–H2 periods, including expired, current, used, and upcoming states. Select any available current or closed period tile, enter the amount in the one-field popup, and save; the current period uses today's date while retrospective entries use that period's closing date. Usage is applied only to its named, dated period and never carries across a reset boundary; future and fully used periods are disabled.

Memberships, lounge access, hotel status, and elite-night credits are tracked as entitlements but carry an explicit catalog value of $0 and never reduce the annual fee. Automatic point currency, such as anniversary miles, is valued only when the catalog has both a points amount and a dated point valuation. `net_value_policy: "excluded"` also keeps CLEAR and Global Entry/TSA PreCheck reimbursements out of net and expected counted value, even if older usage rows have a positive saved valuation ratio. Their balances and private usage remain trackable; no history is deleted.

### Hotel free-night awards

Hyatt Category 1–4, Marriott Boundless 35K and Hilton Aspire awards now use
certificate-specific, source-linked defaults, not point ceilings or invented
cash equivalents. These are editorial reasonable redemption estimates, not
measured statistical averages. All three standard certificates expire 12 months
from issuance/deposit; actual hotel-account dates are authoritative. Card
anniversaries never fabricate an award or its expiry.

**Add award** records actual expiry with the catalog value prefilled. Issuance
can remain unknown; a separate observation date never pretends to be issuance.
Bonus Marriott 50K certificates have their own sourced default, separate from
the anniversary 35K award. Extra certificates are individually labeled, not
assumed earned automatically. The next card-anniversary date is displayed
separately; it is not a guarantee of immediate award issuance.
**Use free night** asks for the actual stay date and defaults to that sourced
value; an optional value adjustment excludes extra points, fees and unrelated
savings. Expiring awards contribute $0 to net until used. Non-expiring awards
count once in their issuance year without a use log, never again at redemption.
There are currently no non-expiring certificates in the owned-card catalog.
Available recorded awards keep their estimates and expiry reminders in the
free-night panels, separate from annual remaining, potential credit value and
available-now dollar-credit totals;
unknown issuance never manufactures a balance or countdown. Hyatt stays must
check out before expiry; Marriott check-in can be on expiry; Hilton stays must
be completed by expiry. Booking alone is not a completed stay.

Used/expired awards have a collapsed history and retrospective correction form.
For a known completed stay whose exact date is unknown, a bookkeeping year can
be recorded separately and labeled confirmed or estimated. This counts in that
year without fabricating a stay date. A used historical award may have unknown
issuance/expiry; its expiring classification remains explicit so a missing date
can never accidentally turn it into an automatic non-expiring grant.
Removed mistakes retain an audit record. Revisions reject stale changes and
request IDs make retries duplicate-safe. Catalog changes do not reprice saved
awards. Hotel cards with an award to track remain in the main wallet even if
they have no dollar credits.

The authenticated `POST /v1/awards` endpoint accepts `wallet_card_id`,
`benefit_id`, `expires_on`, optional `issued_on`/`label`, and `request_id`.
Non-expiring certificates require a known issuance date for annual recognition.
Use/correction supplies `id`, `expected_revision`, and `used_on` (null clears
an incorrect dated redemption), or `used_year` with `used_year_confidence` for
year-only bookkeeping; clearing both fields removes an incorrect redemption.
`value_usd` is optional and defaults to the sourced
per-award estimate; `voided: true` retires a mistaken record without deletion.
CLI: `crdits award save --help` lists the same fields. All dates, award labels,
amounts and audit history are private SQLite data; never enter certificate codes.

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
