# Catalog boundary

The repository catalog contains versioned facts shared by all holders of a card product:

- issuer and exact product identity;
- annual fee and foreign-transaction fee;
- reward currency, multipliers, caps, and dated categories;
- recurring statement credits and non-cash benefits;
- effective dates, verification status, and source URLs.

The local SQLite database contains user-specific or sensitive state:

- which cards the user owns, nicknames, and last four digits;
- benefit usage and personal valuations;
- targeted issuer offers and activation state;
- notes and reminder preferences.

Never migrate local fields into the public catalog. Never overwrite a historical public definition; let the structured catalog commands archive and replace it.

Editorial point valuations are assumptions. Preserve the valuation basis and source, and distinguish them from cash floors.
