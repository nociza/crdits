# Contributing to crdits

Card definitions are public facts. Wallet ownership, usage, preferences,
targeted offers, account notes, issuer credentials, and transaction data are
not.

For a catalog change:

1. Prefer the issuer's current official terms or benefit page.
2. Include the source URL and effective date.
3. Use the structured catalog commands so the prior definition is archived in
   `history`.
4. Run `npm run catalog:validate` and `npm run check`.
5. Keep the pull request limited to the relevant catalog files and tests.

Never include card numbers, credentials, cookies, account screenshots,
transaction exports, or personal offer details in an issue or pull request.
