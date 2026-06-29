# Руководство по развёртыванию WFM-платформы Телесейлз-Сервис

## Стек
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, PostgreSQL
- **Frontend**: Node 20+, React 18, Vite, Tailwind CSS
- **Сервер**: Ubuntu 22.04 LTS (или Debian 12)
- **Reverse-proxy**: Nginx
- **Process manager**: systemd (backend) + Nginx (frontend static)
- **DB**: PostgreSQL 15+ (для WFM), read-only коннект к Naumen PostgreSQL (внешний)

---

## 1. Подготовка сервера

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv python3-pip nodejs npm postgresql postgresql-contrib nginx git
```

Если Node < 20:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

---

## 2. Пользователь и директории

```bash
sudo useradd -m -s /bin/bash wfm
sudo mkdir -p /opt/wfm
sudo chown wfm:wfm /opt/wfm
sudo -u wfm git clone git@github.com:bobaleck/wfm-tss.git /opt/wfm/app
```

---

## 3. PostgreSQL — создание базы

```bash
sudo -u postgres psql << 'EOF'
CREATE USER wfm_user WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE wfm_db OWNER wfm_user;
GRANT ALL PRIVILEGES ON DATABASE wfm_db TO wfm_user;
EOF
```

---

## 4. Backend

### 4.1 Виртуальное окружение и зависимости

```bash
sudo -u wfm bash
cd /opt/wfm/app/backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4.2 Конфигурация `.env`

```bash
cp .env.example .env
nano .env
```

Заполните файл `.env`:

```env
# Ключ для JWT — сгенерируйте: python3 -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=your_secret_key_here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480

# База WFM (PostgreSQL)
WFM_DATABASE_URL=postgresql+psycopg2://wfm_user:CHANGE_ME_STRONG_PASSWORD@localhost:5432/wfm_db

# Naumen PostgreSQL (read-only, внешний сервер)
NCC_DB_HOST=naumen-db-host
NCC_DB_NAME=nccrep
NCC_DB_USER=ncc_readonly
NCC_DB_PASSWORD=ncc_password
NCC_DB_PORT=5432
```

### 4.3 Инициализация базы и первый запуск

```bash
cd /opt/wfm/app/backend
source venv/bin/activate
python run.py   # создаст таблицы и superuser admin/admin123
```

Убедитесь, что сервер запустился на порту 8000, затем остановите (`Ctrl+C`).

### 4.4 Systemd-сервис

```bash
sudo nano /etc/systemd/system/wfm-backend.service
```

```ini
[Unit]
Description=WFM Backend (FastAPI)
After=network.target postgresql.service

[Service]
User=wfm
WorkingDirectory=/opt/wfm/app/backend
Environment=PATH=/opt/wfm/app/backend/venv/bin
# ВАЖНО: ровно ОДИН воркер. Приложение хранит состояние в памяти процесса
# (статусы фоновой синхронизации _sync_jobs, кэши очередей/линий, APScheduler
# ежедневной сверки). При 2+ воркерах статус «Синхронизация» будет теряться,
# а сверка задвоится. Масштабировать — не воркерами, а вертикально.
ExecStart=/opt/wfm/app/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable wfm-backend
sudo systemctl start wfm-backend
sudo systemctl status wfm-backend
```

---

## 5. Frontend — сборка

```bash
cd /opt/wfm/app/frontend
npm ci
```

Создайте файл `.env.production`:

```env
VITE_API_URL=https://wfm.yourdomain.ru/api/v1
```

```bash
npm run build
# Артефакты появятся в dist/
```

---

## 6. Nginx

```bash
sudo nano /etc/nginx/sites-available/wfm
```

```nginx
server {
    listen 80;
    server_name wfm.yourdomain.ru;

    # Редирект на HTTPS (включить после получения сертификата)
    # return 301 https://$host$request_uri;

    root /opt/wfm/app/frontend/dist;
    index index.html;

    # SPA — все неизвестные пути → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy → FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1024;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/wfm /etc/nginx/sites-enabled/wfm
sudo nginx -t
sudo systemctl reload nginx
```

### 6.1 HTTPS — Let's Encrypt (опционально)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d wfm.yourdomain.ru
sudo systemctl reload nginx
```

---

## 7. Права на frontend dist

```bash
sudo chown -R www-data:www-data /opt/wfm/app/frontend/dist
sudo chmod -R 755 /opt/wfm/app/frontend/dist
```

---

## 8. Первый вход и настройка

1. Откройте браузер: `http://wfm.yourdomain.ru`
2. Войдите: **admin / admin123**
3. **Немедленно** смените пароль: Настройки → Смена пароля
4. Перейдите в **Интеграции** и введите данные Naumen PostgreSQL
5. Нажмите «Проверить соединение» — должно появиться «Соединение успешно»
6. Выберите проект в шапке — данные загрузятся автоматически
7. Перейдите в **Сотрудники** → «Синхронизировать» для загрузки операторов из Naumen

---

## 9. Обновление (после `git pull`)

```bash
cd /opt/wfm/app

# Backend
sudo systemctl stop wfm-backend
cd backend && source venv/bin/activate && pip install -r requirements.txt
sudo systemctl start wfm-backend

# Frontend
cd ../frontend && npm ci && npm run build
sudo chown -R www-data:www-data dist/
sudo systemctl reload nginx
```

---

## 10. Резервное копирование базы

```bash
# Создать бэкап
sudo -u postgres pg_dump wfm_db > /opt/wfm/backups/wfm_$(date +%Y%m%d_%H%M).sql

# Восстановить
sudo -u postgres psql wfm_db < /opt/wfm/backups/wfm_YYYYMMDD_HHMM.sql
```

Добавьте в cron:
```bash
sudo crontab -e
# 0 3 * * * sudo -u postgres pg_dump wfm_db > /opt/wfm/backups/wfm_$(date +\%Y\%m\%d).sql
```

---

## 11. Переменные окружения — полный список

| Переменная | Описание | Обязательная |
|---|---|---|
| `SECRET_KEY` | JWT signing key (32+ hex chars) | Да |
| `WFM_DATABASE_URL` | PostgreSQL WFM: `postgresql+psycopg2://user:pass@host/db` | Да |
| `NCC_DB_HOST` | Naumen DB host | Через UI |
| `NCC_DB_NAME` | Naumen DB name (обычно `nccrep`) | Через UI |
| `NCC_DB_USER` | Naumen DB user | Через UI |
| `NCC_DB_PASSWORD` | Naumen DB password | Через UI |
| `NCC_DB_PORT` | Naumen DB port (default 5432) | Через UI |
| `ALGORITHM` | JWT algorithm (default HS256) | Нет |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token TTL (default 480) | Нет |

> Параметры Naumen можно задать и в `.env`, и через веб-интерфейс (раздел Интеграции). Настройки из UI имеют приоритет.

---

## 12. Важные замечания

- SQLite используется **только в dev-режиме** (`run.py` на localhost). В продакшне — PostgreSQL через `DATABASE_URL`.
- Backend автоматически мигрирует схему при старте (добавляет отсутствующие колонки).
- Ежедневная сверка смен с Naumen запускается в **07:00 МСК** через APScheduler.
- Все запросы к Naumen PostgreSQL — **read-only** (SELECT only).
