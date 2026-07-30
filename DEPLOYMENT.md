# Yumio — Deployment (yumiogo.com)

The whole product runs behind **one proxy port: `3042`**.

```
                    ┌─────────────────────────────────────────┐
  yumiogo.com  ───► │ nginx (443)  →  127.0.0.1:3042          │
  www.yumiogo.com   │                    │                    │
                    │                    ├── /api/*   API     │
                    │                    ├── /uploads/* files │
                    │                    └── /*       SPA     │
                    └─────────────────────────────────────────┘
```

The Express server serves the API, the uploaded files **and** the built client,
so nginx only needs a single `proxy_pass`.

---

## 1. Defaults (works with no `.env`)

| Setting | Default |
|---|---|
| Port | `3042` |
| Domain | `yumiogo.com` in production, `localhost` in development |
| Database | `mongodb://localhost:27017/yumio` |
| Client build path | `../admin-web/dist` or `../client/dist` (override with `CLIENT_DIST`) |
| Default admin | `admin@yumio.app` / `Admin123!` |

**Production still requires** three secrets and a Mongo URI — the server refuses
to start without them (it prints exactly what is missing):

```bash
cd server
cp .env.example .env

# generate three different values
openssl rand -hex 32   # ACCESS_SECRET_KEY
openssl rand -hex 32   # REFRESH_SECRET_KEY
openssl rand -hex 32   # ENCRYPTION_KEY
```

Minimum production `.env`:

```env
NODE_ENV=production
PORT=3042
MONGODB_URI=mongodb://127.0.0.1:27017/yumio
ACCESS_SECRET_KEY=<random>
REFRESH_SECRET_KEY=<random>
ENCRYPTION_KEY=<random>
DEFAULT_ADMIN_EMAIL=admin@yumiogo.com
DEFAULT_ADMIN_PASSWORD=<strong password>
```

`DOMAIN`, `APP_URL` and `CLIENT_URL` default to `yumiogo.com` — set them only if
you use a different host.

---

## 2. Build and start

```bash
# client (produces admin-web/dist, served by the API server)
cd admin-web && npm ci && npm run build

# server
cd ../server && npm ci --legacy-peer-deps
npm run seed          # optional: demo data
NODE_ENV=production npm start
```

Keep it alive with pm2:

```bash
pm2 start app.js --name yumio --cwd /var/www/yumio/server --env production
pm2 save && pm2 startup
```

> The client needs **no** `VITE_API_URL` in production — the bundle calls `/api`
> on its own origin. Set it only when the API lives on a different host.

---

## 3. nginx

```nginx
server {
    listen 80;
    server_name yumiogo.com www.yumiogo.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yumiogo.com www.yumiogo.com;

    ssl_certificate     /etc/letsencrypt/live/yumiogo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yumiogo.com/privkey.pem;

    # uploads can be large (images)
    client_max_body_size 12M;

    location / {
        proxy_pass         http://127.0.0.1:3042;
        proxy_http_version 1.1;

        # WebSocket upgrade (Socket.IO)
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # real client IP — the app sets `trust proxy`, needed for rate limiting
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 60s;
    }
}
```

Certificate: `sudo certbot --nginx -d yumiogo.com -d www.yumiogo.com`

---

## 4. Mobile app

`src/config/env.js` already points production builds at `https://yumiogo.com/api`
— no configuration needed. Rebuild the APK after deploying:

```bash
cd mobile
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

Because production uses HTTPS you can drop the `usesCleartextTraffic` flag from
`app.json` (it exists only so LAN `http://` works during development).

To point a build at a different backend:

```bash
EXPO_PUBLIC_API_URL=https://staging.yumiogo.com/api npx expo start
```


---

## 5. CI/CD (GitHub Actions)

Hər repoda `.github/workflows/deploy.yml` var — `main`-ə push olunanda VPS-ə
SSH ilə girib deploy edir.

### VPS qovluq quruluşu

```
/var/www/yumio/
├── server/     ← yumiogo-server repo (pm2 "yumio", port 3042)
└── client/     ← yumiogo-client repo (build → client/dist)
```

Server `client/dist`-i avtomatik tapır (`../client/dist`), ona görə **client
deploy-dan sonra serveri restart etmək lazım deyil**.

### GitHub Secrets (hər iki repoda eyni)

| Secret | Nə |
|---|---|
| `HOST` | VPS IP və ya host adı |
| `USERNAME` | SSH istifadəçisi |
| `SECRET_KEY` | SSH private key (tam məzmun) |

SSH portu workflow-da `2222` kimi yazılıb.

### İlk quraşdırma (bir dəfəlik)

```bash
sudo mkdir -p /var/www/yumio && cd /var/www/yumio
git clone https://github.com/AliAghayev132/yumiogo-server.git server
git clone https://github.com/AliAghayev132/yumiogo-client.git client

# server .env (yuxarıdakı 1-ci bölmə)
cd server && cp .env.example .env && nano .env

# ilk build + start
cd ../client && npm ci --legacy-peer-deps && npm run build
cd ../server && npm ci --omit=dev --legacy-peer-deps
pm2 start app.js --name yumio --time --cwd /var/www/yumio/server
pm2 save && pm2 startup
```

### Deploy ardıcıllığı

İkisi paralel qaça bilər — asılılıq yoxdur:
- **client** push → `npm ci` → `npm run build` → `dist/` yenilənir (restart yox)
- **server** push → `npm ci --omit=dev` → `pm2 restart yumio` → health check

Hər iki workflow uğursuz olanda dayanır: client köhnə `dist`-i geri qaytarır
(rollback), server isə pm2 loglarını çap edib `exit 1` verir.

### Qeydlər

- Client **`VITE_API_URL` təyin etmir** — production bundle öz origin-inə
  (`/api`) müraciət edir.
- Client-də `npm ci` `NODE_ENV=development` ilə çağırılır, çünki Vite və build
  alətləri `devDependencies`-dədir (`NODE_ENV=production` onları atlayır).
- Server `--omit=dev` ilə qurulur; `devDependencies` yalnız eslint/prettier/nodemon-dur.
- `--legacy-peer-deps` eslint 10 ↔ eslint-plugin-import peer konflikti üçün lazımdır.

---

## 6. Post-deploy checks

```bash
curl -I  https://yumiogo.com/                 # 200, HTML (landing)
curl -s  https://yumiogo.com/api/health       # {"success":true,...}
curl -I  https://yumiogo.com/login            # 200 (SPA fallback)
curl -s  https://yumiogo.com/api/nope         # 404 JSON, not HTML
```

Then log in at `https://yumiogo.com/login` with the admin account and open
**Settings → Demo data** to seed or clear content.

### Uploads

Files land in `server/uploads/` and are served from `/uploads/...`. That folder is
git-ignored — back it up (or move it to S3) separately from the code.
