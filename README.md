# DDNS Updater

A small, self-hosted DDNS updater with a web UI, **extensible provider interface**, and configurable update period.
Inspired by [`qdm12/ddns-updater`](https://github.com/qdm12/ddns-updater), but with a **REST API** for managing
domains and records without restarting the service and a **React** front-end.

- **Backend**: Node.js (Express) with a JWT-protected API. Persists config + history in a single JSON file.
- **Frontend**: React (Vite + Tailwind), served by Nginx and reverse-proxying `/api/*` to the backend.
- **Data model**: **Domain** = a credentialed account/zone (e.g. `namecheap:example.com`,
  `cloudflare:example.com`). **Record** = one subdomain (or apex `@`) hanging off that domain. Add many
  records for one domain without re-entering the password.

## Providers shipped

| Provider     | Credentials needed (Domain)               | Notes                                                              |
|--------------|-------------------------------------------|--------------------------------------------------------------------|
| `namecheap`  | `domainName`, `password`                  | One Dynamic DNS password per apex. Records are subdomain labels.   |
| `cloudflare` | `domainName`, `apiToken`                  | **Records are auto-created** if they don't yet exist.              |
| `duckdns`    | `domainName` (= `duckdns.org`), `token`   | One token per account, all hosts in `*.duckdns.org`.               |
| `noip`       | `domainName`, `username`, `password`      | Works for free `no-ip.org` hosts and Plus custom hostnames.        |
| `dynu`       | `domainName`, `username`, `password`      | Works for free `dynu.net` hosts.                                   |
| `desec`      | `domainName`, `token`                     | Username is ignored; token is the password.                        |

Adding a new provider = one class file + one line in `_PROVIDERS` (see `backend/src/providers/`).

## Quick start

```bash
# 1. Set an admin password (otherwise a random one is generated and printed once).
export ADMIN_PASSWORD='change-me'

# 2. Build & run
docker compose up -d --build

# 3. Open the UI
#    http://localhost:3010
```

When the backend first boots it:
1. Hashes `$ADMIN_PASSWORD` with bcrypt and stores it in `data/admin.json`.
2. Migrates `data/config.json` from the v1 (`hosts[]`) layout to v2
   (`domains[] + records[]`) automatically. Existing entries are regrouped by
   `(provider, apex)` so multiple subdomains under the same domain share one
   password entry.
3. Issues a JWT and brings up the scheduler.

## Data model (v2)

```jsonc
// data/config.json
{
  "schemaVersion": 2,
  "periodSeconds": 300,
  "lastIp": "1.2.3.4",
  "lastIpCheckAt": "2024-…",
  "domains": [
    {
      "id": "…", "provider": "namecheap",
      "displayName": "Home server",
      "enabled": true,
      "settings": { "domainName": "example.com", "password": "…" },
      "lastUpdateAt": "…", "lastUpdateStatus": "success", "lastError": null
    }
  ],
  "records": [
    {
      "id": "…", "domainId": "…",
      "enabled": true,
      "config": { "host": "ddns" },
      "lastCheckedIp": "1.2.3.4", "lastUpdateAt": "…", "lastUpdateStatus": "success"
    },
    { "id": "…", "domainId": "…", "config": { "host": "@" }, /* … */ },
    { "id": "…", "domainId": "…", "config": { "host": "vpn" }, /* … */ }
  ]
}
```

The scheduler iterates **enabled records** whose parent domain is also enabled,
merges `{...domain.settings, ...record.config}` and calls the provider's
`update(ip)`. A heartbeat re-update fires every 25 days so records don't
expire even when your IP doesn't change. Single-flight guard prevents
concurrent cycles; per-provider timeout (30 s) prevents a hung upstream
from stalling the loop.

## Environment variables

| Variable                 | Default                      | Purpose                                                              |
|--------------------------|------------------------------|----------------------------------------------------------------------|
| `ADMIN_PASSWORD`         | _(empty → auto-generated)_   | The admin password. Persisted as a bcrypt hash. **Set this in prod.**|
| `JWT_SECRET`             | _(derived from admin hash)_  | Signing key for JWTs. Leave empty unless you want to manage it yourself. |
| `TOKEN_TTL_SECONDS`      | `86400`                      | Lifetime of the JWT returned on login.                               |
| `DEFAULT_PERIOD_SECONDS` | `300`                        | Initial update period.                                               |
| `MIN_PERIOD_SECONDS`     | `30`                         | Lower bound (prevents hammering upstream services).                  |
| `IP_PROVIDERS`           | `api.ipify.org, ifconfig.me, icanhazip.com` | Comma-separated public-IP detection endpoints.        |
| `IP_REQUEST_TIMEOUT_MS`  | `8000`                       | Per-IP-provider request timeout.                                     |
| `PROVIDER_REQUEST_TIMEOUT_MS` | `15000`                 | Per DNS-provider request timeout.                                    |
| `LOG_LEVEL`              | `info`                       | `debug`, `info`, `warn`, `error`.                                    |
| `PORT` (backend)         | `4010`                       | Internal port the backend listens on (also the host-mapped port).    |
| `HOST` (backend)         | `0.0.0.0`                    | Bind interface inside the container.                                 |
| `CORS_ORIGINS`           | _(empty)_                    | Comma-separated origins. Leave empty when using Nginx same-origin proxy. |

## Ports

| Service  | Container port | Host port |
|----------|---------------:|----------:|
| frontend | 3010           | 3010      |
| backend  | 4010           | 4010      |

The frontend proxies `/api/*` to the backend over the internal Docker network.
The backend is **also** exposed on port `4010` of the host so you can hit the
API directly with `curl`; it still requires the JWT bearer token on everything
except `GET /api/health` and `POST /api/auth/login`.

## API

All routes are JSON. All except the marked ones require
`Authorization: Bearer <jwt>`.

| Method | Path                                      | Purpose                                            |
|--------|-------------------------------------------|----------------------------------------------------|
| GET    | `/api/health`                             | Public — `{ok, version, providers}`                |
| GET    | `/api/providers`                          | Public — list of providers + their fields          |
| POST   | `/api/auth/login`                         | Public — `{password}` → `{token, ttlSeconds}`      |
| GET    | `/api/settings`                           | Read period / limits                               |
| PUT    | `/api/settings`                           | `{periodSeconds}` — updates scheduler live         |
| GET    | `/api/domains`                            | List domains (with `recordCount`)                  |
| GET    | `/api/domains/:id`                        | One domain + its records                           |
| POST   | `/api/domains`                            | `{provider, displayName, settings}` create         |
| PUT    | `/api/domains/:id`                        | Update displayName / settings / enabled            |
| DELETE | `/api/domains/:id`                        | Cascade delete (removes all records)               |
| POST   | `/api/domains/:id/refresh`                | Force an immediate cycle for this domain           |
| POST   | `/api/domains/:id/test`                   | Connectivity test against the upstream provider    |
| GET    | `/api/domains/:domainId/records`          | List records under a domain                        |
| POST   | `/api/domains/:domainId/records`          | `{host, …recordFields…}` create                    |
| PUT    | `/api/domains/:domainId/records/:id`      | Patch `config` or `enabled`                        |
| DELETE | `/api/domains/:domainId/records/:id`      | Delete record                                      |
| GET    | `/api/records`                            | Flat record list (for the Dashboard)               |
| POST   | `/api/records/:id/refresh`                | Force a single record update                       |
| POST   | `/api/records/:id/test`                   | Connectivity test for a single record              |
| GET    | `/api/status`                             | Snapshot used by the Dashboard                     |
| POST   | `/api/status/refresh`                     | Force an immediate scheduler cycle (all enabled)   |

SECRET fields under `settings` (`password`, `apiToken`, `token`, `secret`,
`apikey`, `api_key`) are redacted to `***redacted***` on every response.

## Persistence

Everything lives under the named volume `ddns-data` mounted at `/app/data`
in the backend container:

```
/app/data/
├── admin.json     # bcrypt hash + JWT secret derivation of the admin password
└── config.json    # schemaVersion=2, domains[], records[], settings
```

To back up, snapshot this volume (e.g.
`docker run --rm -v ddns-proxy-updater_ddns-data:/data -v $PWD:/backup alpine tar czf /backup/ddns-data.tgz /data`).

## Adding a new provider

1. Create `backend/src/providers/MyProvider.js` (extend `BaseProvider` or
   `NicUpdateProvider` if it follows the nic/update pattern). The schema
   shape is:

   ```js
   static getSchema() {
     return {
       label: 'MyProvider',
       help:  'One line shown next to the provider picker.',
       domainFields: [
         // credential-style fields attached to the domain
       ],
       recordFields: [
         // per-record fields (always at least a `host` label)
       ],
     };
   }
   ```

2. Register it in `backend/src/providers/index.js` (one entry in
   `_PROVIDERS`).

3. Restart the backend image.

The UI picks up the new provider automatically via `GET /api/providers`.

## Security notes

- All endpoints except `GET /api/health`, `GET /api/providers`, and
  `POST /api/auth/login` require a bearer JWT (HMAC-SHA256, configurable TTL).
- Domain credentials are stored in `config.json` (plaintext on the host
  volume). The volume is the trust boundary; anyone with read access to the
  filesystem already has the host. Encrypting in-process would create a
  chicken-and-egg problem with backups and manual edits.
- `helmet`, login rate-limiter (20 attempts / 15 min), and bcrypt (cost 12)
  are enabled by default.
- Single-flight scheduler guarantees that only one update cycle runs at a
  time. Per-record timeout (30 s) so a hung upstream cannot stall the loop.

## Local development

```bash
# Backend
cd backend && npm install && npm run dev       # listens on :4010

# Frontend (proxies /api to the backend on http://localhost:4010 in dev)
cd frontend && npm install && npm run dev      # Vite dev server on :5173
```

## License

MIT.
