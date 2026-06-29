# Деплой WFM «Телесейлз-Сервис» — runbook для ИИ-агента

Цель: развернуть/обновить платформу на Linux-сервере (Ubuntu 22.04/Debian 12) с
нуля или накатить обновление. Документ самодостаточен и рассчитан на автономного
агента: команды идемпотентны, после каждого блока — как проверить успех.

Базовый человекочитаемый гайд — [DEPLOY.md](DEPLOY.md). Здесь — сжатый
исполнимый план + специфика последнего релиза (проектная изоляция, роли,
миграция X5, обязательный один воркер).

Репозиторий: `git@github.com:bobaleck/wfm-tss.git`. Структура: `backend/`
(FastAPI), `frontend/` (React+Vite).

---

## 0. Критические инварианты (НЕ нарушать)

1. **Backend запускать РОВНО одним воркером uvicorn** (`--workers 1`). В памяти
   процесса живут: статусы фоновой синхронизации (`_sync_jobs`), кэши
   очередей/исходящих линий, планировщик ежедневной сверки (APScheduler). При
   2+ воркерах статус «Синхронизация» теряется, а сверка смен задваивается.
   Горизонтально не масштабировать.
2. **`SECRET_KEY` обязателен в проде.** Дефолт в коде (`dev-secret-change-in-production`)
   — только для разработки. Без своего ключа JWT можно подделать. Сгенерировать:
   `python3 -c "import secrets; print(secrets.token_hex(32))"`.
3. **Naumen — только чтение (SELECT).** Подключение к Naumen задаётся через UI
   (раздел «Интеграции») или `.env`; настройки из UI имеют приоритет.
4. **Один экземпляр backend на одну WFM-базу** (из-за in-process планировщика).
5. После деплоя/обновления backend **обязательно перезапустить** (сбросить
   накопленные соединения к Naumen и in-process кэши).

---

## 1. Зависимости системы

```bash
sudo apt update && sudo apt install -y python3.11 python3.11-venv python3-pip \
  postgresql postgresql-contrib nginx git curl
# Node 20+ (если в репозиториях старее):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs
```
Проверка: `python3.11 --version`, `node -v` (≥20), `nginx -v`, `psql --version`.

---

## 2. Код и пользователь

```bash
sudo useradd -m -s /bin/bash wfm 2>/dev/null || true
sudo mkdir -p /opt/wfm && sudo chown wfm:wfm /opt/wfm
# Первый раз:
sudo -u wfm git clone git@github.com:bobaleck/wfm-tss.git /opt/wfm/app
# Обновление:
sudo -u wfm git -C /opt/wfm/app pull --ff-only
```

---

## 3. База WFM (PostgreSQL)

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 << 'EOF'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='wfm_user') THEN
    CREATE USER wfm_user WITH PASSWORD 'CHANGE_ME_STRONG';
  END IF;
END $$;
SELECT 'db exists' FROM pg_database WHERE datname='wfm_db';
EOF
sudo -u postgres createdb -O wfm_user wfm_db 2>/dev/null || true
```
Проверка: `sudo -u postgres psql -lqt | grep wfm_db`.

> SQLite (`WFM_DATABASE_URL=sqlite:///./wfm.db`) допустим только для дев/демо.
> В проде — PostgreSQL. Миграции схемы на старте срабатывают и для SQLite, и для
> PostgreSQL (добавляются недостающие колонки).

---

## 4. Backend

```bash
cd /opt/wfm/app/backend
python3.11 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt   # включает openpyxl (Excel-экспорт/импорт)
```

`.env` (на основе `.env.example`):
```env
SECRET_KEY=<вставь вывод: python3 -c "import secrets; print(secrets.token_hex(32))">
ACCESS_TOKEN_EXPIRE_MINUTES=480
WFM_DATABASE_URL=postgresql+psycopg2://wfm_user:CHANGE_ME_STRONG@localhost:5432/wfm_db
# Naumen можно оставить пустым и задать через UI:
NCC_DB_HOST=
NCC_DB_NAME=nccrep
NCC_DB_USER=readonly
NCC_DB_PASSWORD=
NCC_DB_PORT=5432
CORS_ORIGINS=https://wfm.yourdomain.ru
```

Проверка импорта (без запуска сервера):
```bash
cd /opt/wfm/app/backend && PYTHONPATH=. ./venv/bin/python -c "import app.main; print('ok')"
```

systemd-сервис `/etc/systemd/system/wfm-backend.service`:
```ini
[Unit]
Description=WFM Backend (FastAPI)
After=network.target postgresql.service

[Service]
User=wfm
WorkingDirectory=/opt/wfm/app/backend
EnvironmentFile=/opt/wfm/app/backend/.env
ExecStart=/opt/wfm/app/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now wfm-backend
curl -fsS http://127.0.0.1:8000/health   # ожидаем {"status":"ok",...}
```

На первом старте в журнале (`journalctl -u wfm-backend -n 50`) будет:
- `[OK] Admin created: login=admin password=admin123` (только если админа ещё нет);
- `[OK] Orphans -> X5 (...)` — если найден проект с «X5» в названии и были
  сотрудники/команды без проекта (миграция идемпотентна, повторно не вредит).

---

## 5. Frontend

```bash
cd /opt/wfm/app/frontend
npm ci
# при необходимости задать адрес API:
echo 'VITE_API_URL=https://wfm.yourdomain.ru/api/v1' > .env.production
npm run build           # → frontend/dist
sudo chown -R www-data:www-data dist
```
Проверка: `test -f dist/index.html && echo built`.

---

## 6. Nginx

См. готовый конфиг в [DEPLOY.md](DEPLOY.md) §6 (SPA + proxy `/api/` → 127.0.0.1:8000,
`proxy_read_timeout 120s`). Затем:
```bash
sudo nginx -t && sudo systemctl reload nginx
```
HTTPS: `sudo certbot --nginx -d wfm.yourdomain.ru`.

---

## 7. Пост-деплой (обязательно)

1. Войти `admin / admin123` → **сразу сменить пароль** в Личном кабинете.
   Восстановление пароля сотрудника — только администратором.
2. **Интеграции** → ввести параметры Naumen PostgreSQL → «Проверить соединение».
3. Выбрать проект в шапке. **Сотрудники → Синхронизировать** — подтянуть операторов.
4. Настроить **роли и доступ к проектам** (см. §8) — иначе менеджеры/кураторы не
   увидят данные.

---

## 8. Роли и проектная изоляция (изменено в этом релизе)

Полная изоляция проектов друг от друга, **включая смены, графики, отсутствия,
команды, очереди, аналитику и мониторинг**.

- **Доступ ко ВСЕМ проектам** — только роли `admin` и `analyst` (и
  `is_superuser`). Они видят и сводят данные по всем проектам.
- **Все остальные роли** (`project_manager`, `customer`, `hr`, `viewer`) видят
  **только назначенные им проекты**. Без назначения они не увидят ничего и
  получат 403 на проектных эндпоинтах — это ожидаемо.

Назначение проектов пользователю (админом):
- через UI: Пользователи → выбрать пользователя → проекты;
- или через API:
  ```bash
  # список проектов: GET /api/v1/integrations/tracked-projects
  curl -X POST https://wfm.yourdomain.ru/api/v1/users/<USER_ID>/projects \
    -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
    -d '{"project_uuid":"<CUSTOMER_UUID>"}'
  ```

«Сироты» (сотрудники/команды без проекта) при старте автоматически привязываются
к проекту, в названии которого есть «X5». Если такого проекта нет — миграция
тихо пропускается (создайте проект X5 заранее, если это нужно).

Проверка изоляции (smoke-test): зайти под `project_manager`, назначенным на один
проект, и убедиться, что в Сменах/Сотрудниках/Мониторинге видны только его данные.

---

## 9. Обновление (накат новой версии)

```bash
sudo -u wfm git -C /opt/wfm/app pull --ff-only
# backend
cd /opt/wfm/app/backend && ./venv/bin/pip install -r requirements.txt
sudo systemctl restart wfm-backend        # перезапуск ОБЯЗАТЕЛЕН
PYTHONPATH=. ./venv/bin/python -c "import app.main" && curl -fsS http://127.0.0.1:8000/health
# frontend
cd /opt/wfm/app/frontend && npm ci && npm run build
sudo chown -R www-data:www-data dist && sudo systemctl reload nginx
```
Схема БД мигрируется автоматически на старте (новые колонки добавляются;
существующие данные не теряются).

---

## 10. Диагностика

| Симптом | Причина / действие |
|---|---|
| Статус «Синхронизация» висит/сбрасывается | Запущено >1 воркера. Оставить `--workers 1`. |
| Сверка смен сработала дважды | То же — несколько воркеров/экземпляров. |
| Менеджер видит «Нет доступа к проекту» (403) | Не назначены проекты в `user_projects` (см. §8). |
| Excel-экспорт/импорт падает | Не установлен `openpyxl` → `pip install -r requirements.txt`. |
| Naumen «база недоступна»/таймаут | Проверить PgBouncer/доступность; перезапустить backend (сброс соединений). |
| 401 у всех запросов после рестарта | Сменился `SECRET_KEY` → старые токены недействительны (норма; войти заново). |

Логи: `journalctl -u wfm-backend -f`. Здоровье: `GET /health`.

---

## 11. Резервные копии

```bash
sudo -u postgres pg_dump wfm_db > /opt/wfm/backups/wfm_$(date +%Y%m%d_%H%M).sql
# cron 03:00 ежедневно — см. DEPLOY.md §10
```
Файл WFM-базы и логи в гит не коммитим (закрыто `.gitignore`).
