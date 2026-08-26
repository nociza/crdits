# Dedicated private service

For real wallet data, run the API in its own unprivileged guest. The checked-in
systemd unit expects:

- the repository at `/srv/crdits`, owned by root with only `catalog/cards`
  writable by the `crdits` group;
- the SQLite directory at `/var/lib/crdits`, owned by `crdits`, mode `0700`;
- a long random bearer token at `/etc/crdits/api-token`, owned by
  `root:crdits`, mode `0640`;
- `/etc/crdits/crdits.env` containing the guest's stable Tailscale address;
- Node.js 24 or newer at `/usr/local/bin/node`.

The unit permits network traffic only over loopback and the Tailscale CGNAT
range. It gives the application write access only to SQLite and public catalog
definitions. Do not bind the API to `0.0.0.0`, expose it through the public
tunnel, or reuse an observability credential.

The calling dashboard should store the matching token in its own protected
file and inject it server-side. Telemetry may poll `/v1/monitor`; card names,
benefits, offers, usage, notes, and transaction data must not be exported.

Before importing a real wallet, configure an encrypted backup destination in a
separate failure domain and perform a representative restore. A copy elsewhere
on the same Proxmox host is not a sufficient backup.
