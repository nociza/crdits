# Catalog boundary

The repository catalog contains versioned facts shared by all holders of a card product:

- issuer and exact product identity;
- annual fee and foreign-transaction fee;
- reward currency, multipliers, caps, and dated categories;
- recurring statement credits and non-cash benefits;
- the public tracking behavior (`spend`, `automatic`, `enrollment`, or `reference`) for each benefit;
- effective dates, verification status, and source URLs.

The local SQLite database contains user-specific or sensitive state:

- which cards the user owns, nicknames, and last four digits;
- benefit usage and personal valuations;
- membership-year anchors and persistent one-time enrollment status;
- targeted issuer offers and activation state;
- notes and reminder preferences.

Never migrate local fields into the public catalog. Never overwrite a historical public definition; let the structured catalog commands archive and replace it.

Editorial point valuations are assumptions. Preserve the valuation basis and source, and distinguish them from cash floors.

Tracking behavior is a public product fact, but whether a holder activated a benefit is private. Automatic bonuses and statuses must never require usage entries. Anniversary benefits must not receive a calendar-year fallback when the private membership-year anchor is absent.

Activation and entitlement do not imply financial value. Enrollment benefits, lounge access, hotel status, and elite-night credits contribute zero dollars to projected net value. Automatic point currency may contribute value only when `points_amount` and the card's public point valuation are both present.
