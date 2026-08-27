# Command reference

Run commands from the repository or use the installed `crdits` executable.

## Read

```text
crdits summary --json
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
crdits use --card ID_OR_SLUG --benefit BENEFIT_ID --amount USD --date YYYY-MM-DD --note TEXT
crdits benefit activate --card ID_OR_SLUG --benefit BENEFIT_ID --date YYYY-MM-DD --note TEXT
crdits offer add --card ID_OR_SLUG --merchant NAME --title TEXT --reward-amount USD --expires YYYY-MM-DD --activated
```

`--card` accepts a local wallet id, catalog slug, or exact nickname.

## Public catalog writes

```text
crdits catalog import-csv PATH
crdits catalog upsert-benefit --card SLUG --title TITLE --tracking-type TRACKING --amount-usd USD --points-amount POINTS --cadence CADENCE --valid-from YYYY-MM-DD --source-url URL --description TEXT
crdits catalog upsert-reward --card SLUG --category CATEGORY --rate N --rate-type points_multiplier --match-terms "term, term" --valid-from YYYY-MM-DD --source-url URL
crdits catalog patch-card --card SLUG --annual-fee-usd USD --point-value-cents CPP --verified-at YYYY-MM-DD --source-url URL
```

Valid cadences are `monthly`, `quarterly`, `semiannual`, `annual`, `anniversary`, `every_n_years`, and `one_time`.

Valid tracking types are `spend`, `automatic`, `enrollment`, and `reference`. `--amount-usd` is optional for automatic point bonuses and reference benefits. Only `spend` accepts `crdits use`; only `enrollment` accepts `benefit activate`.
