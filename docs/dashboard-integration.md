# Dashboard integration boundary

`crdits` should appear as part of the private dashboard experience without sharing the observability application's process, database, credentials, or telemetry namespace.

## Recommended shape

1. Run `crdits` in its own unprivileged guest or service boundary.
2. Bind its Node API to loopback and expose the web app only through a dedicated reverse-proxy origin.
3. Give the browser origin its own Cloudflare Tunnel/Access application if off-tailnet access is required.
4. Add a dashboard navigation link to that origin after deployment is verified.
5. Poll only `GET /v1/monitor` for the fleet dashboard or Teleclaw health indicator.

The sanitized monitor response contains only:

```json
{
  "ok": true,
  "as_of": "2026-08-26",
  "active_cards": 10,
  "reminders_due": 3,
  "urgent_reminders": 1,
  "projected_net_usd": 425
}
```

It excludes card names, nicknames, last four digits, benefits, targeted offers, usage, merchant names, and notes. Do not send those private fields to Netdata, VictoriaMetrics, Grafana, or the fleet monitor API.

The full `/v1/dashboard` API is intended only for the authenticated crdits web origin. When `CRDITS_API_TOKEN` is set, the same-origin web proxy injects it server-side.

## Existing Fleet repository

The Fleet repository currently contains unrelated, uncommitted dashboard remediation. Keep the crdits integration as a separate, reviewable change after the service origin and Access policy exist. This repository therefore ships the integration contract but does not mutate or deploy the Fleet worktree.
