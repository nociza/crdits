# Dashboard integration boundary

`crdits` should appear as part of the private dashboard experience without sharing the observability application's process, database, credentials, or telemetry namespace.

## Recommended shape

1. Run `crdits` in its own service boundary inside an unprivileged guest. A
   trusted small-app guest may be shared, but the Unix identity, SQLite path,
   token, port, and systemd sandbox may not be shared.
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

`projected_net_usd` is realized value used in the current year minus annual fees. Unused expected value is returned separately and must not be added to this field.

It excludes card names, nicknames, last four digits, benefits, targeted offers, usage, merchant names, and notes. Do not send those private fields to Netdata, VictoriaMetrics, Grafana, or the fleet monitor API.

The full `/v1/dashboard` API is intended only for the authenticated crdits web origin. When `CRDITS_API_TOKEN` is set, the same-origin web proxy injects it server-side.

## Nexus Fleet deployment

The Nexus Fleet deployment uses LXC 112 `smoldb` on NW1. CardCredits remains a
separate process and SQLite boundary inside that guest; `nw1-observe` owns only
the authenticated presentation proxy. The deployment and encrypted backup
worker are maintained in the private Fleet repository, not this public
project.
