# deployment

How to run nodeward in production. The security reasoning behind every step
here is in [security.md](security.md) — this file is the "do this" side.

## Docker (recommended)

```sh
git clone https://github.com/hydniz/nodeward && cd nodeward
cat > .env << 'EOF'
ADMIN_PASSWORD=$(openssl rand -base64 18)
AGENT_JOIN_TOKEN=$(openssl rand -base64 24)
EOF
docker compose up -d --build
```

That is a complete deployment: sqlite store, login-protected dashboard on
`:4001`, enrolment open for agents holding the join token. All state (the
sqlite file and the logs) lives in the `nodeward-data` volume — **backing up
nodeward means backing up that one volume**:

```sh
docker run --rm -v nodeward_nodeward-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/nodeward-backup.tgz -C /data .
```

Updating: `git pull && docker compose up -d --build`. The sqlite schema is
applied idempotently on boot; agents re-connect on their own (their tokens
live in the volume-backed store, not in the process).

## TLS

The node process speaks plain http; the reverse proxy owns tls. With caddy
that is three lines — add to the compose file:

```yaml
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    command: caddy reverse-proxy --from nodeward.example.com --to nodeward:4001
    volumes:
      - caddy-data:/data
```

(and add `caddy-data:` under `volumes:`, remove the `ports:` mapping from the
nodeward service, set `TRUST_PROXY: "1"`). Caddy provisions and renews the
certificate on its own. Any other proxy (nginx, traefik) works the same way —
terminate tls, forward to `:4001`, keep `x-forwarded-for` honest, and match
`TRUST_PROXY` to the hop count.

## Bare metal (systemd)

Node ≥ 22.6 required. Build once, then run the server under systemd:

```sh
npm ci && npm run build
```

```ini
# /etc/systemd/system/nodeward.service
[Unit]
Description=nodeward
After=network-online.target

[Service]
User=nodeward
WorkingDirectory=/opt/nodeward
ExecStart=/usr/bin/node --experimental-strip-types server/src/index.ts
Environment=NODE_ENV=production
Environment=SQLITE_PATH=/var/lib/nodeward/nodeward.db
Environment=LOG_DIR=/var/lib/nodeward/logs
EnvironmentFile=/etc/nodeward/env    # ADMIN_PASSWORD, AGENT_JOIN_TOKEN
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Backup = `/var/lib/nodeward`.

## Enrolling the first agent

The agent protocol is documented in [../README.md](../README.md) and
[agent-enrolment.md](agent-enrolment.md); until the reference agent ships,
enrolment by hand looks like:

```sh
curl -s https://nodeward.example.com/api/agents/register \
  -H 'content-type: application/json' \
  -d '{"joinToken":"<AGENT_JOIN_TOKEN>","hostId":"myhost","name":"myhost","version":"0.1.0"}'
```

## The whole env surface

Every variable is documented in the table in [../README.md](../README.md).
The ones a deployment actually decides:

| variable | why you set it |
| --- | --- |
| `ADMIN_PASSWORD` | the dashboard login; production refuses to boot without it (or an explicit `AUTH_DISABLED=true`) |
| `AGENT_JOIN_TOKEN` | what agents enrol with; unset = enrolment closed |
| `TRUST_PROXY` | `1` behind one reverse proxy, so client ips (and the rate limits keyed on them) stay honest |
| `SQLITE_PATH` | where the database lives — put it on the volume you back up |
| `DEMO_DATA` | `true` to explore the ui with the demo fleet before any agent reports |
