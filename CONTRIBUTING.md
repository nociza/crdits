# Contributing to crdits

Card definitions are public facts. Wallet ownership, usage, preferences,
targeted offers, account notes, issuer credentials, and transaction data are
not.

For a catalog change:

1. Prefer the issuer's current official terms or benefit page.
2. Include the source URL, effective date, valuation method, value, basis, and valuation date.
3. Use the structured catalog commands so the prior definition is archived in
   `history`.
4. Run `npm run catalog:validate` and `npm run check`.
5. Keep the pull request limited to the relevant catalog files and tests.

Never include card numbers, credentials, cookies, account screenshots,
transaction exports, or personal offer details in an issue or pull request.

Use `face_value` for a finite issuer-denominated dollar credit, `points` for a points or miles amount multiplied by a dated public cents-per-point estimate, and `excluded` for lounge access, subscriptions, status, elite-night credits, or another entitlement that must not reduce the annual fee automatically. Use `market_estimate` only when the contribution includes a reproducible public methodology. Editorial estimates must be described as estimates, never guaranteed cash value.
