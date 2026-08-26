# Teleclaw integration

Teleclaw's gateway scheduler should execute this repository's deterministic poller once each morning:

```text
cd /path/to/crdits && npm run teleclaw:poll
```

Provide these values through the gateway's protected host-local runtime configuration:

```text
CRDITS_REMINDERS_URL=https://private-crdits-origin.example/v1/reminders
CRDITS_API_TOKEN=host-local-bearer-token
CRDITS_REMINDERS_DAYS=14
```

The process prints either one bounded, grouped reminder message or the exact sentinel `NO_REPLY`. It never invokes a model, shell command, issuer account, or Telegram API itself. Teleclaw remains responsible for its existing delivery, retry, and job schedule behavior.

Run `npm run catalog:refresh-plan` monthly as a separate agent-enabled job. That command only identifies stale or unconfirmed public catalog entries; the agent must verify official issuer sources, make structured catalog edits, validate them, and present the Git diff. It must not read the private SQLite database or targeted offers.

Do not commit the job definition, bearer token, Telegram destination, or poller state. The poller state defaults to `~/.local/state/crdits-reminders/state.json` with directory mode `0700` and file mode `0600`.
