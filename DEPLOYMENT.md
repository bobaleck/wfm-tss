# Deployment Guide — WFM Телесейлз-Сервис

## Overview

| Component | Stack | Default port |
|-----------|-------|-------------|
| Backend   | FastAPI + SQLite (dev) / PostgreSQL (prod) | 8000 |
| Frontend  | React 18 + Vite (built → static) | 5173 (dev) / served by nginx (prod) |
| Database  | SQLite for dev (`wfm.db`), PostgreSQL for prod | — |
| Naumen DB | Read-only PostgreSQL (external) | 5432 |

---

## Prerequisites

- Python 3.11+
- Node.js 20+ / npm 10+
- (Prod) PostgreSQL 14+, nginx

---

## 1. Clone & install

```bash
git clone <repo-url>
cd wfm-telesales
```

### Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

---

## 2. Environment variables

Copy `.env.example` → `.env` in the `backend/` folder:

```bash
cp backend/.env.example backend/.env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | JWT signing key — **change in prod** | `dev-secret-key` |
| `DATABASE_URL` | SQLAlchemy DB URL | `sqlite:///./wfm.db` |
| `NCC_DB_HOST` | Naumen PostgreSQL host | — |
| `NCC_DB_NAME` | Naumen database name | `nccrep` |
| `NCC_DB_USER` | Naumen DB user | — |
| `NCC_DB_PASSWORD` | Naumen DB password | — |
| `NCC_DB_PORT` | Naumen DB port | `5432` |
| `FIRST_ADMIN_PASSWORD` | Password auto-created admin account | `admin123` |

---

## 3. Initialize database & create admin

```bash
cd backend
# Creates all tables (SQLAlchemy create_all) + seeds admin user
python -m app.core.init_db
```

Default admin: **username** `admin`, **password** from `FIRST_ADMIN_PASSWORD`.

---

## 4. Run in development

```bash
# Terminal 1 — backend (auto-reload)
cd backend
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend (HMR)
cd frontend
npm run dev
```

Frontend proxies `/api` to `http://localhost:8000` (see `vite.config.ts`).

Open **http://localhost:5173**.

---

## 5. Build frontend for production

```bash
cd frontend
npm run build
# Output: frontend/dist/
```

---

## 6. Production deployment (Linux + nginx + systemd)

### 6.1 Backend service

Create `/etc/systemd/system/wfm-backend.service`:

```ini
[Unit]
Description=WFM Backend
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/wfm/backend
EnvironmentFile=/opt/wfm/backend/.env
ExecStart=/opt/wfm/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable wfm-backend
systemctl start wfm-backend
```

### 6.2 nginx

```nginx
server {
    listen 80;
    server_name wfm.example.com;

    # Serve built frontend
    root /opt/wfm/frontend/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

### 6.3 PostgreSQL (prod database)

```bash
createdb wfm
# Set DATABASE_URL=postgresql+psycopg2://user:pass@localhost/wfm in .env
cd backend && python -m app.core.init_db
```

---

## 7. Codex / AI agent setup

For an AI coding agent (OpenAI Codex, Claude Code, etc.) to work with this repo:

### Key commands

| Task | Command |
|------|---------|
| Install backend deps | `cd backend && pip install -r requirements.txt` |
| Install frontend deps | `cd frontend && npm install` |
| Type check | `cd frontend && npx tsc --noEmit` |
| Start backend | `cd backend && uvicorn app.main:app --reload` |
| Start frontend | `cd frontend && npm run dev` |
| Build frontend | `cd frontend && npm run build` |
| Run DB migrations | `cd backend && python -m app.core.init_db` |

### Project structure

```
wfm-telesales/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # FastAPI routers (analytics, users, integrations…)
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic schemas
│   │   ├── services/        # naumen_db.py — Naumen read queries
│   │   └── core/            # config, database, security
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/           # React pages (dashboard, analytics, settings…)
    │   ├── components/      # Shared UI components
    │   ├── store/           # Zustand stores (auth, project)
    │   ├── types/index.ts   # All TypeScript types + role definitions
    │   └── utils/           # Helpers (sl.ts for SL color logic)
    └── package.json
```

### Important constraints

- **No new external integrations** — Naumen PostgreSQL is the only data source; do not add new integration endpoints.
- **Naumen DB is read-only** — all `naumen_db.py` queries use `SELECT` only.
- **Role system** — `admin | project_manager | analyst | hr | customer | viewer`. `project_manager` and `customer` see only their assigned projects (`user_projects` table).
- **SL coloring** — always relative to `target_sl` per queue using `slColor()` from `src/utils/sl.ts`.
- **Status grouping** — in ShiftsPage, statuses map to 4 groups (Работает / Простой / Офлайн / Другое). Keep this consistent with `OperatorLoadPage.idle_sec` which counts time in PAUSE statuses.

### Database schema additions (auto-applied on startup)

- `user_projects` — maps users to projects for project-scoped roles
- `queue_settings` — per-queue SL and answer_sec WFM overrides
- `tracked_projects` — WFM-managed project list
