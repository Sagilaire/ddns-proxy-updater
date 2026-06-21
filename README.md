# DDNS Updater

A small, self-hosted DDNS updater with a web UI, **extensible provider interface**, and configurable update period.
Inspired by [`qmcgaw/ddns-updater`](https://github.com/qdm12/ddns-updater), but with a **REST API** for managing hosts
without restarting the service and a **React** front-end.

- **Backend**: Node.js (Express) with a JWT-protected API. Persists config + history in a single JSON file.
- **Frontend**: React (Vite + Tailwind), served by Nginx and reverse-proxying `/api/*` to the backend.
- **Providers**: pluggable; ships with **Namecheap** out of the box. See *Adding a provider* below.

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
2. Issues you to `http://localhost:3010` — log in, add your Namecheap host(s), done.

### Environment variables

| Variable                 | Default                      | Purpose                                                              |
|--------------------------|------------------------------|----------------------------------------------------------------------|
| `ADMIN_PASSWORD`         | _(empty → auto-generated)_   | The admin password. Persisted as a bcrypt hash. **Set this in prod.**|
| `JWT_SECRET`             | _(derived from admin hash)_  | Signing key for JWTs. Leave empty unless you want to manage it yourself. |
| `TOKEN_TTL_SECONDS`      | `86400`                      | Lifetime of the JWT returned on login.                               |
| `DEFAULT_PERIOD_SECONDS` | `300`                        | Initial update period.                                               |
| `MIN_PERIOD_SECONDS`     | `30`                         | Lower bound (prevents hammering upstream services).                  |
| `IP_PROVIDERS`           | `api.ipify.org, ifconfig.me, icanhazip.com` | Comma-separated public-IP detection endpoints.        |
| `LOG_LEVEL`              | `info`                       | `debug`, `info`, `warn`, `error`.                                    |
| `FRONTEND_PORT`          | `3010`                       | Host port mapped to the frontend Nginx.                              |

### Ports

| Service  | Container port | Host port |
|----------|---------------:|----------:|
| frontend | 3010           | 3010      |
| backend  | 4010           | 4010      |

The frontend proxies `/api/*` to the backend over the internal Docker network.
The backend is **also** exposed on port `4010` of the host so you can hit the
API directly with `curl` for debugging; it still requires the JWT bearer
token on everything except `GET /api/health` and `POST /api/auth/login`.

## Persistence

Everything lives under the named volume `ddns-data` mounted at `/app/data` in the backend container:

```
/app/data/
├── admin.json     # bcrypt hash of the admin password
└── config.json    # { periodSeconds, hosts: [...], lastIp, lastIpCheckAt }
```

To back up, snapshot this volume (e.g. `docker run --rm -v ddns-proxy-updater_ddns-data:/data -v $PWD:/backup alpine tar czf /backup/ddns-data.tgz /data`).

## Adding a new provider

1. Create `backend/src/providers/MyProvider.js`:

   ```js
   const BaseProvider = require('./BaseProvider');
   class MyProvider extends BaseProvider {
     static getName() { return 'myprovider'; }
     static getSchema() {
       return [
         { key: 'domain',  label: 'Domain',  type: 'text',     required: true },
         { key: 'host',    label: 'Host',    type: 'text',     required: true },
         { key: 'password',label: 'Token',   type: 'password', required: true },
       ];
     }
     async update(ip) {
       // hit the provider API, return { ok, message }
     }
   }
   module.exports = MyProvider;
   ```

2. Register it in `backend/src/providers/index.js`:

   ```js
   const MyProvider = require('./MyProvider');
   ...
   _PROVIDERS = { [NamecheapProvider.getName()]: NamecheapProvider, [MyProvider.getName()]: MyProvider }
   ```

3. Restart the backend image.

The UI automatically picks up the new provider option from `GET /api/hosts`.

## Security notes

- All endpoints except `GET /api/health` and `POST /api/auth/login` require a bearer JWT.
- Host passwords/keys are **never** returned in API responses — `config.password` is redacted to `***redacted***`.
- `helmet`, rate limiting on `/api/auth/login`, and bcrypt (cost 12) for password hashing are enabled.
- The backend listens only on the internal Docker network — the only public entry point is the frontend.

## Local development

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (proxies /api to the backend on http://localhost:4010 in dev)
cd frontend && npm install && npm run dev
```

## License

MIT.
