# Command reference

Run commands from the repository or use the installed `crdits` executable.

## Read

```text
crdits summary --json
crdits summary --year YYYY --json
crdits history --card WALLET_ID --benefit BENEFIT_ID --json
crdits due --days 30 --json
crdits recommend CATEGORY --merchant MERCHANT --amount USD --json
crdits wallet list --json
crdits catalog stale --days 45 --json
crdits catalog validate --json
```

## Private SQLite writes

```text
crdits wallet add --catalog-slug SLUG --nickname NAME --last-four 1234 --membership-year-start YYYY-MM-DD
crdits wallet update --card ID_OR_SLUG --membership-year-start YYYY-MM-DD
crdits wallet import-csv PATH
crdits use --card ID_OR_SLUG --benefit BENEFIT_ID --amount USD --date YYYY-MM-DD --period YYYY-MM|YYYY-QN|YYYY-HN --note TEXT
crdits set-used --card ID_OR_SLUG --benefit BENEFIT_ID --amount TOTAL --previous CURRENT_TOTAL --date YYYY-MM-DD --period PERIOD_KEY --request-id UNIQUE_REQUEST_ID
crdits benefit activate --card ID_OR_SLUG --benefit BENEFIT_ID --date YYYY-MM-DD --note TEXT
crdits offer add --card ID_OR_SLUG --merchant NAME --title TEXT --reward-amount USD --expires YYYY-MM-DD --activated
```

`--card` accepts a local wallet id, catalog slug, or exact nickname.
`history` requires the numeric wallet ID from `summary`. `use` also accepts `--request-id`; reusing it with the same payload is idempotent. Changing a payload requires a new ID. `set-used` is a period total, not an increment, and rejects stale `--previous` totals or totals above the credit limit.
`--period` is optional for ordinary spend credits and required by the skill workflow when recording a monthly, quarterly, or semiannual credit. It may name a current or closed period; its date must fall inside that period, and future usage is rejected.

## Recommendation context

`recommend` accepts `--context JSON`. Use `confirmed_rules` containing `catalog_slug:rule_id` only when the user has confirmed all rule eligibility. `remaining_caps` maps `catalog_slug:cap_group_or_rule_id` to remaining qualifying spend, not the nominal annual cap. `channel` must match the catalog constraint (for example `bilt-travel`, `capital-one-travel`, or `direct`). Amounts beyond a confirmed cap fall back to unconditional earn. Without context, conditional alternatives are informational and do not inflate the winner.

For Bilt, the `other-1` rule's remaining cap is the unused everyday-spend capacity backed by the current housing payment, not the whole housing payment. Keep its 3.33X estimate conditional; do not invent rent or assume it is unspent.

## Public catalog writes

```text
crdits catalog import-csv PATH
crdits catalog upsert-benefit --card SLUG --title TITLE --tracking-type TRACKING --amount-usd USD --points-amount POINTS --cadence CADENCE --valid-from YYYY-MM-DD --source-url URL --valuation-method METHOD --valuation-value-usd USD --valuation-basis TEXT --valuation-source-url URL --valuation-as-of YYYY-MM-DD --description TEXT
crdits catalog upsert-reward --card SLUG --category CATEGORY --rate N --rate-type points_multiplier --match-terms "term, term" --valid-from YYYY-MM-DD --source-url URL
crdits catalog patch-card --card SLUG --annual-fee-usd USD --point-value-cents CPP --valuation-basis TEXT --valuation-source-url URL --valuation-as-of YYYY-MM-DD --verified-at YYYY-MM-DD --source-url URL
```

Valid cadences are `monthly`, `quarterly`, `semiannual`, `annual`, `anniversary`, `every_n_years`, and `one_time`.

Valid tracking types are `spend`, `automatic`, `enrollment`, and `reference`. `--amount-usd` is optional for automatic point bonuses and reference benefits. Only `spend` accepts `crdits use`; only `enrollment` accepts `benefit activate`.

Valid valuation methods are `face_value`, `points`, `market_estimate`, and `excluded`. Structured benefit updates derive the value when possible, but public contributions should provide an explicit basis, source, and date.
