# Teleclaw routines

## Daily reminders

Run once each morning:

```text
npm run teleclaw:poll
```

Set `CRDITS_REMINDERS_URL` to the private `/v1/reminders` endpoint and point
`CRDITS_API_TOKEN_FILE` at its host-local protected bearer-token file. The
poller validates a bounded response, groups urgent items first, and stores only
a fingerprint under `~/.local/state/crdits-reminders`. It prints `NO_REPLY`
when the result is empty or unchanged. Keep the scheduler definition, Telegram
destination, and token out of Git.

For a same-host installation, the default URL is `http://127.0.0.1:8788/v1/reminders`. `CRDITS_REMINDERS_DAYS` defaults to 14.

## Weekly value check

Run once weekly:

```text
crdits summary --json
```

Notify only when projected net value (realized value minus annual fees) crosses zero, an annual-fee reminder enters the configured window, or expected value materially changes. Never add unused expected credits to projected net.

## Low-frequency catalog refresh

Run monthly:

```text
npm run catalog:refresh-plan
```

For each returned card, verify the official issuer page before secondary sources. Refresh dated point valuations from a transparent public methodology. Write structured updates with an effective date, valuation method, value, basis, source, and valuation date; validate the catalog and report the diff. Do not scrape issuer accounts and do not process targeted offers in this routine.
