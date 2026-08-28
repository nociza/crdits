# Catalog boundary

The repository catalog contains versioned facts shared by all holders of a card product:

- issuer and exact product identity;
- annual fee and foreign-transaction fee;
- reward currency, multipliers, caps, and dated categories;
- recurring statement credits and non-cash benefits;
- the public tracking behavior (`spend`, `automatic`, `enrollment`, or `reference`) for each benefit;
- a public valuation method, value, basis, source URL, and `as_of` date for every benefit;
- effective dates, verification status, and source URLs.

The local SQLite database contains user-specific or sensitive state:

- which cards the user owns, nicknames, and last four digits;
- benefit usage and optional personal overrides;
- membership-year anchors and persistent one-time enrollment status;
- targeted issuer offers and activation state;
- notes and reminder preferences.

Never migrate local fields into the public catalog. Never overwrite a historical public definition; let the structured catalog commands archive and replace it.

Use `face_value` for a finite issuer-denominated dollar credit. Use `points` for explicit points or miles multiplied by a dated, sourced cents-per-point estimate. Use `excluded` at $0 for memberships, subscriptions, statuses, elite-night credits, and unsupported certificates. Reserve `market_estimate` for a reproducible public methodology. Editorial point valuations are estimates; preserve their basis, source, and date, and distinguish them from cash floors.

Tracking behavior is a public product fact, but whether a holder activated a benefit is private. Automatic bonuses and statuses must never require usage entries. Anniversary benefits must not receive a calendar-year fallback when the private membership-year anchor is absent.

Activation and entitlement do not imply financial value. Enrollment benefits, lounge access, hotel status, and elite-night credits contribute zero dollars to projected net value. Automatic point currency may contribute value only when `points_amount` and the card's public point valuation are both present.
