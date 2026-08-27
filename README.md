# crdits

`crdits` is a local-first credit-card value ledger. It tracks recurring credits, targeted offers, actual usage, realistic expected value, annual-fee ROI, reward categories, point values, and which owned card should be used for a purchase.

The project deliberately has two sources of truth:

- `catalog/cards/*.json` is the public, versioned, community-maintained card catalog.
- `.data/crdits.sqlite` is the private wallet, usage, valuation, offer, and reminder ledger.

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

Catalog definitions have effective dates and sources. Structured update commands archive a replaced definition in the card's `history` before writing the new version.

```bash
npm run crdits -- catalog upsert-benefit \
  --card chase-sapphire-preferred \
  --title "Hotel credit" \
  --amount-usd 100 \
  --cadence anniversary \
  --valid-from 2026-06-23 \
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

## Expected value

For each current or future benefit cycle in the calendar year:

```text
expected value = remaining face value × probability of use × personal value percentage
```

Targeted offers are shown separately and never added automatically to expected value. Editorial point valuations remain labeled assumptions; card recommendations show their estimated dollar return.

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

Tests cover catalog import, recurring cycles, partial usage, expected value, recommendations, SQLite isolation, and the server-rendered application shell.

## License

MIT
