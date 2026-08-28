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

## Expected value

No valuation setup is required for a normal wallet. For each current or future benefit cycle in the calendar year:

```text
expected value = sourced catalog value × remaining balance share
```

Dollar statement credits default to 100% of issuer-stated face value. Editorial point valuations remain labeled estimates rather than guaranteed cash value. Existing local preference rows remain supported as optional advanced overrides, while targeted offers stay separate and are never added automatically to expected value.

Derived earn rates retain their math and limits in the public catalog. For example, Bilt Palladium's conditional 3.33X catch-all combines 2X base points with 1.33X from 4% Bilt Cash redeemed toward housing points. It applies only under Flexible Bilt Cash while housing unlock capacity remains—about the first 75% of monthly housing spend. The annual $200 Bilt Cash allocation is conservatively valued at $66.67 using that redemption and a 1-cent-per-point cash floor.

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

Tests cover catalog import, recurring and anniversary cycles, automatic and enrollment behavior, partial usage, expected value, recommendations, SQLite isolation, and the server-rendered application shell.

## License

MIT
