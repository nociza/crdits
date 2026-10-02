# Catalog boundary

The repository catalog contains versioned facts shared by all holders of a card product:

- issuer and exact product identity;
- annual fee and foreign-transaction fee;
- reward currency, multipliers, caps, and dated categories;
- recurring statement credits and non-cash benefits;
- the public tracking behavior (`spend`, `automatic`, `enrollment`, or `reference`) for each benefit;
- a public valuation method, value, basis, source URL, and `as_of` date for every benefit;
- derived reward-rate components, eligibility conditions, and cap formulas when a headline multiplier combines currencies;
- effective dates, verification status, and source URLs.

The local SQLite database contains user-specific or sensitive state:

- which cards the user owns, nicknames, and last four digits;
- benefit usage and optional personal overrides;
- membership-year anchors and persistent one-time enrollment status;
- targeted issuer offers and activation state;
- notes and reminder preferences.

Never migrate local fields into the public catalog. Never overwrite a historical public definition; let the structured catalog commands archive and replace it.

Use `face_value` for a finite issuer-denominated dollar credit. Use `points` for explicit points or miles multiplied by a dated, sourced cents-per-point estimate. Use `excluded` at $0 for memberships, subscriptions, statuses, elite-night credits, and unsupported certificates. Reserve `market_estimate` for a reproducible public methodology. Editorial point valuations are estimates; preserve their basis, source, and date, and distinguish them from cash floors.

For Bilt Palladium under Flexible Bilt Cash, the catalog's 3.33X catch-all is conditional: 2X base points plus 4% Bilt Cash converted at $30 per 1,000 housing points. The conversion adds 1.33 points per everyday dollar and exhausts the full 1X housing unlock after everyday spend reaches roughly 75% of monthly housing. This purchase-reward model is separate from coupon accounting.

The annual $200 Bilt Cash allocation retains its nominal balance. `redemption_policy` separates issuer-backed gross redemptions from CardCredits' explicit incremental-value convention: a rounded $0.33-per-dollar normal-rewards baseline is excluded; $1 cash/eligible credit redemption therefore contributes only $0.67 per dollar, or $134 when the full allocation is used as cash. Points use consumes the balance but contributes $0 beyond that baseline. Expected unused value is the maximum cash-route increment, never realized value. The method and pinned ratio of each actual redemption are private ledger data, not public product facts. Do not silently revalue old records when changing the policy; preserve them until an authorized correction.

Tracking behavior is a public product fact, but whether a holder activated a benefit is private. Automatic bonuses and statuses must never require usage entries. Anniversary benefits must not receive a calendar-year fallback when the private membership-year anchor is absent.

Activation and entitlement do not imply financial value. Enrollment benefits, lounge access, hotel status, and elite-night credits contribute zero dollars to projected net value. Automatic point currency may contribute value only when `points_amount` and the card's public point valuation are both present.
