# WFM Platform: развёртывание ИИ-агентом на чистом сервере

Это каноническая инструкция для ИИ-агента, который получил новый Linux-сервер
с интернетом и доступом к GitHub и должен полностью развернуть WFM Platform.
Она относится только к серверу. На рабочем компьютере разработчика PostgreSQL
не устанавливать, `backend/wfm.db` не изменять и данные Naumen не сохранять.

Репозиторий: `git@github.com:bobaleck/wfm-tss.git`, ветка `main`.
Рабочий путь на сервере: `/opt/wfm/app`.

Официальные справочные материалы:

- Ubuntu: https://ubuntu.com/server/docs/install-and-configure-postgresql/
- Ubuntu UFW: https://ubuntu.com/server/docs/security-firewall/
- Nginx reverse proxy: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- Certbot: https://certbot.eff.org/instructions


## 1. Что агент обязан получить до начала

Нужны:

1. root-доступ или пользователь с рабочим `sudo`;
2. Ubuntu Server 24.04 LTS либо Debian 12, архитектура amd64/arm64;
3. GitHub deploy key или иной доступ на чтение к репозиторию;
4. домен, уже направленный A/AAAA-записью на сервер, если нужен HTTPS;
5. email для Let's Encrypt;
6. сложный временный пароль первого администратора либо разрешение его
   сгенерировать;
7. read-only реквизиты PostgreSQL Naumen и сетевой доступ сервера к нему;
8. список проектов, которые надо добавить после первого запуска.

Если нет Git-доступа, агент создаёт SSH-ключ, показывает пользователю только
публичный ключ и останавливается до добавления deploy key в GitHub. Если нет
домена, платформу можно закончить по HTTP/IP, но HTTPS помечается незавершённым.
Если нет Naumen-реквизитов/маршрута, сама WFM должна быть развёрнута, а живая
аналитика помечена «ожидает настройки интеграции».

Никогда не выводить в чат, логи или Git:

- `.env`, JWT `SECRET_KEY`, пароли PostgreSQL/Naumen;
- admin-пароль;
- токены GitHub и приватные SSH-ключи;
- ФИО, логины и выгрузки сотрудников.


## 2. Неизменяемая production-архитектура

- Nginx принимает 80/443, отдаёт React SPA и проксирует `/api/`.
- FastAPI слушает только `127.0.0.1:8000`.
- Backend запускается ровно в одном экземпляре и с `--workers 1`.
- Собственная WFM-база — локальный PostgreSQL, не SQLite.
- PostgreSQL слушает только localhost; порт 5432 наружу не открывать.
- Naumen — внешний read-only источник.
- Историческая аналитика хранится в PostgreSQL WFM в `analytics_cache`:
  общий TTL 10 минут, удержание снимков до 31 дня.
- Один и тот же точный запрос десяти пользователей вызывает один запрос к
  Naumen; остальные получают общий снимок.
- Активные ключи обновляет APScheduler. После чистого старта первый запрос по
  новому диапазону синхронно получает данные из Naumen и регистрирует ключ.
- При временной недоступности Naumen допустим старый снимок не старше 31 дня;
  ошибка обновления хранится в `last_error`.
- Раздел «Мониторинг» не использует 10-минутный analytics cache: текущие
  статусы и recent stats запрашиваются у Naumen на каждый API-вызов. Только
  медленно меняющиеся карты «оператор → очередь/линия» имеют малый процессный
  кэш для подписей; сами live-показатели из него не берутся.
- Проекты лежат в `tracked_projects`, сотрудники — в `employees`.
- Автосинхронизация сотрудников выполняется раз в 60 минут. Она читает окно
  Naumen за 90 дней и поэтому намеренно не запускается каждые 10 минут.
- Ручные проекты (`is_manual=1`) автоматическая синхронизация пропускает.

Два и более backend worker запрещены: в памяти процесса находятся scheduler,
задачи синхронизации и вспомогательные live-кэши. Несколько экземпляров
задвоят периодические задания и дадут противоречивые статусы.


## 3. Предварительная проверка сервера

```bash
set -euo pipefail
cat /etc/os-release
uname -m
id
df -h /
free -h
getent hosts github.com
```

Рекомендуемый стартовый минимум для небольшой команды: 2 vCPU, 4 GB RAM,
30 GB SSD. Для сборки frontend желательны 4 GB RAM; при меньшем объёме заранее
создать swap по политике владельца сервера.

Проверить время:

```bash
timedatectl status
sudo timedatectl set-timezone Europe/Moscow
```


## 4. Пакеты ОС

```bash
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt install -y \
  ca-certificates curl git openssl build-essential libpq-dev \
  python3 python3-venv python3-pip \
  nodejs npm \
  postgresql postgresql-contrib \
  nginx ufw
```

Проверка:

```bash
python3 --version
node --version
npm --version
git --version
psql --version
nginx -v
sudo systemctl is-active postgresql
sudo systemctl is-active nginx
```

Требуется Python 3.11+ и Node.js 18+. Если версия ниже, не продолжать сборку:
установить поддерживаемую версию из официального репозитория выбранной ОС и
повторить проверку. Не выполнять неизвестные `curl | bash` скрипты.


## 5. Системный пользователь и GitHub

```bash
id wfm >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash wfm
sudo install -d -o wfm -g wfm -m 0755 /opt/wfm
sudo install -d -o wfm -g wfm -m 0700 /home/wfm/.ssh
```

Если deploy key ещё не выдан:

```bash
sudo -u wfm -H ssh-keygen -t ed25519 -C "wfm-production-deploy" \
  -f /home/wfm/.ssh/id_ed25519 -N ""
sudo -u wfm -H cat /home/wfm/.ssh/id_ed25519.pub
```

Добавить только этот публичный ключ в GitHub как read-only deploy key. Затем
выполнить обычную проверку SSH host key и доступа. Не отключать
`StrictHostKeyChecking`.

```bash
sudo -u wfm -H ssh -T git@github.com || true
sudo -u wfm -H git clone --branch main --single-branch \
  git@github.com:bobaleck/wfm-tss.git /opt/wfm/app
sudo -u wfm -H git -C /opt/wfm/app status --short --branch
sudo -u wfm -H git -C /opt/wfm/app remote -v
```

Ожидание: ветка `main`, чистое дерево, origin указывает на `bobaleck/wfm-tss`.
Прочитать `/opt/wfm/app/project-map.txt`, затем продолжить по этому документу.


## 6. Секреты и bootstrap-файл

Сгенерированные реквизиты временно держать в
`/root/wfm-bootstrap-credentials.txt` с правами `0600`. Не печатать файл.
После передачи admin-пароля владельцу и проверки входа файл удалить.

```bash
sudo bash -c '
set -euo pipefail
umask 077
test -f /root/wfm-bootstrap-credentials.txt || {
  printf "WFM_DB_PASSWORD=%s\n" "$(openssl rand -hex 24)" > /root/wfm-bootstrap-credentials.txt
  printf "SECRET_KEY=%s\n" "$(openssl rand -hex 32)" >> /root/wfm-bootstrap-credentials.txt
  printf "FIRST_ADMIN_PASSWORD=%s\n" "$(openssl rand -base64 24 | tr -d "\n")" >> /root/wfm-bootstrap-credentials.txt
}
chmod 600 /root/wfm-bootstrap-credentials.txt
'
```

Если пользователь передал свой `FIRST_ADMIN_PASSWORD`, заменить значение в
root-файле безопасным редактором. Не передавать секреты параметрами командной
строки, если на сервере ведётся аудит process list/history.


## 7. PostgreSQL WFM

PostgreSQL оставлять на стандартном локальном `listen_addresses=localhost`.
Не добавлять публичный `host ... 0.0.0.0/0` в `pg_hba.conf`.

Загрузить сгенерированный hex-пароль в root shell, не выводя его:

```bash
sudo bash
set -a
source /root/wfm-bootstrap-credentials.txt
set +a
```

На чистом сервере создать роль и базу:

```bash
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='wfm_user'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE wfm_user LOGIN PASSWORD '${WFM_DB_PASSWORD}';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='wfm_db'" | grep -q 1; then
  sudo -u postgres createdb --owner=wfm_user --encoding=UTF8 wfm_db
fi
sudo -u postgres psql -d wfm_db -c "SELECT current_database(), current_user;"
exit
```

`WFM_DB_PASSWORD` генерируется hex-строкой, поэтому безопасен внутри URL и
указанной SQL-команды. Для произвольного пользовательского пароля нужна
корректная SQL/URL-экранизация.


## 8. Backend и `.env`

```bash
sudo -u wfm -H bash -c '
set -euo pipefail
cd /opt/wfm/app/backend
python3 -m venv venv
./venv/bin/python -m pip install --upgrade pip
./venv/bin/python -m pip install -r requirements.txt
./venv/bin/python -m pip check
'
```

Создать `/opt/wfm/app/backend/.env` с владельцем `wfm:wfm`, правами `0600`.
Файл уже исключён из Git. Значения в угловых скобках заменить без вывода в
терминал:

```env
SECRET_KEY=<SECRET_KEY из root bootstrap-файла>
FIRST_ADMIN_PASSWORD=<FIRST_ADMIN_PASSWORD из root bootstrap-файла>
ACCESS_TOKEN_EXPIRE_MINUTES=480
ALGORITHM=HS256

WFM_DATABASE_URL=postgresql+psycopg2://wfm_user:<WFM_DB_PASSWORD>@127.0.0.1:5432/wfm_db

ANALYTICS_CACHE_ENABLED=true
ANALYTICS_CACHE_TTL_SECONDS=600
ANALYTICS_CACHE_RETENTION_DAYS=31
ANALYTICS_CACHE_REFRESH_SCAN_SECONDS=60

EMPLOYEE_AUTO_SYNC_ENABLED=true
EMPLOYEE_AUTO_SYNC_MINUTES=60

NCC_DB_HOST=<Naumen PostgreSQL host или пусто до настройки>
NCC_DB_NAME=nccrep
NCC_DB_USER=<read-only пользователь>
NCC_DB_PASSWORD=<пароль>
NCC_DB_PORT=5432

NCC_API_BASE_URL=<если реально используется, иначе пусто>
NCC_API_USERNAME=<если реально используется, иначе пусто>
FX_API_KEY=<если реально используется, иначе пусто>

CORS_ORIGINS=https://<домен>
```

Если пока доступ только по HTTP/IP, временно указать точный origin, например
`http://203.0.113.10`. Не использовать `*` вместе с credentials.

```bash
sudo chown wfm:wfm /opt/wfm/app/backend/.env
sudo chmod 600 /opt/wfm/app/backend/.env
sudo -u wfm -H git -C /opt/wfm/app status --short
```

Ожидание: `.env` не отображается в Git status.


## 9. Проверка кода и создание схемы

Тесты используют моки/временную SQLite в памяти и не должны писать в
production-таблицы или обращаться к Naumen.

```bash
sudo -u wfm -H bash -c '
set -euo pipefail
cd /opt/wfm/app/backend
./venv/bin/python -m compileall -q app
./venv/bin/python -m unittest discover -s tests -v
PYTHONPATH=. ./venv/bin/python -c "from app.core.database import init_db; init_db(); print(\"schema initialized\")"
'
sudo -u postgres psql -d wfm_db -tAc \
  "SELECT to_regclass('public.analytics_cache'), to_regclass('public.employees'), to_regclass('public.tracked_projects');"
```

Ожидание: тесты зелёные, три таблицы существуют. На чистом сервере таблицы
создаёт SQLAlchemy `create_all`. Для обновления существующей production-базы
нельзя считать `create_all` заменой миграциям колонок: сначала backup, затем
проверка release-specific изменений модели/SQL.


## 10. systemd backend

Создать `/etc/systemd/system/wfm-backend.service`:

```ini
[Unit]
Description=WFM Platform FastAPI backend
Wants=network-online.target
After=network-online.target postgresql.service

[Service]
Type=simple
User=wfm
Group=wfm
WorkingDirectory=/opt/wfm/app/backend
EnvironmentFile=/opt/wfm/app/backend/.env
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/opt/wfm/app/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGINT
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wfm-backend
sudo systemctl status wfm-backend --no-pager
curl --fail --silent --show-error http://127.0.0.1:8000/health
sudo journalctl -u wfm-backend -n 100 --no-pager
```

Ожидаемый health содержит:

```json
{"status":"ok","analytics_cache":{"enabled":true,"backend":"postgresql","ttl_seconds":600,"retention_days":31}}
```

На первом старте создаётся `admin`; пароль берётся только из
`FIRST_ADMIN_PASSWORD`. Пароль не должен появляться в журнале.


## 11. Frontend

Frontend использует относительный `/api/v1`, поэтому `.env.production` и
`VITE_API_URL` создавать не надо.

```bash
sudo -u wfm -H bash -c '
set -euo pipefail
cd /opt/wfm/app/frontend
npm ci
npm run build
test -f dist/index.html
find dist -type d -exec chmod 755 {} \;
find dist -type f -exec chmod 644 {} \;
'
sudo chmod 755 /opt /opt/wfm /opt/wfm/app /opt/wfm/app/frontend
```


## 12. Nginx

Создать `/etc/nginx/sites-available/wfm` и заменить домен:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name wfm.example.ru;

    root /opt/wfm/app/frontend/dist;
    index index.html;
    client_max_body_size 20m;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    gzip on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;
}
```

Включить сайт:

```bash
sudo ln -sfn /etc/nginx/sites-available/wfm /etc/nginx/sites-enabled/wfm
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1/health
curl --fail --silent --show-error http://127.0.0.1/ | head
```


## 13. Firewall и HTTPS

Сначала обязательно разрешить текущий SSH-порт, иначе можно потерять сервер:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status verbose
```

Не разрешать `8000/tcp` и `5432/tcp` извне.

Если DNS уже указывает на сервер:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d wfm.example.ru --redirect \
  --agree-tos --no-eff-email -m admin@example.ru
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
curl --fail --silent --show-error https://wfm.example.ru/health
```

После включения HTTPS изменить `CORS_ORIGINS` на точный `https://...` и
перезапустить backend:

```bash
sudo systemctl restart wfm-backend
```


## 14. Первый вход и загрузка данных

1. Передать владельцу временный admin-пароль безопасным каналом.
2. Войти `admin`, сразу сменить пароль.
3. Проверить «Интеграции». Если Naumen задан в `.env`, UI-настройки можно не
   дублировать; непустые значения из UI имеют приоритет над `.env`.
4. Нажать тест подключения только из серверной/пользовательской сети, где
   Naumen разрешён.
5. Добавить нужные проекты в `tracked_projects` через экран интеграций.
6. Для каждого не ручного проекта один раз запустить «Сотрудники →
   Синхронизировать» и дождаться статуса `done`.
7. После этого scheduler обновляет сотрудников раз в 60 минут последовательно.
8. Назначить пользователям проекты и роли.
9. Настроить очереди, вход/исход и `hidden`.

Проверить:

- скрытый подпроект отсутствует в аналитических фильтрах и статистике;
- историческая страница после первого запроса создаёт строки в
  `analytics_cache`;
- повтор того же диапазона не создаёт новый запрос к Naumen до истечения TTL;
- «Мониторинг» показывает текущие статусы и обновляется независимо от этого
  cache;
- ограниченный пользователь не получает чужие проекты.

Диагностические запросы без чтения содержимого payload:

```bash
sudo -u postgres psql -d wfm_db -c \
  "SELECT namespace, count(*) AS keys, max(fetched_at) AS newest, count(last_error) AS errors FROM analytics_cache GROUP BY namespace ORDER BY namespace;"
sudo -u postgres psql -d wfm_db -c \
  "SELECT count(*) AS projects FROM tracked_projects; SELECT count(*) AS employees FROM employees;"
```

Не выводить `analytics_cache.payload` и строки сотрудников в журналы/чат.


## 15. Резервное копирование

```bash
sudo install -d -o postgres -g postgres -m 0700 /var/backups/wfm
sudo -u postgres pg_dump --format=custom --file=/var/backups/wfm/wfm_initial.dump wfm_db
sudo -u postgres pg_restore --list /var/backups/wfm/wfm_initial.dump | head
```

Создать `/etc/systemd/system/wfm-backup.service`:

```ini
[Unit]
Description=Backup WFM PostgreSQL

[Service]
Type=oneshot
User=postgres
ExecStart=/bin/bash -c 'umask 077; pg_dump --format=custom wfm_db > /var/backups/wfm/wfm_$(date +%%Y%%m%%d_%%H%%M%%S).dump'
ExecStartPost=/usr/bin/find /var/backups/wfm -maxdepth 1 -type f -name 'wfm_*.dump' -mtime +31 -delete
```

Создать `/etc/systemd/system/wfm-backup.timer`:

```ini
[Unit]
Description=Daily WFM PostgreSQL backup

[Timer]
OnCalendar=*-*-* 03:00:00 Europe/Moscow
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wfm-backup.timer
sudo systemctl start wfm-backup.service
sudo systemctl status wfm-backup.service --no-pager
sudo systemctl list-timers wfm-backup.timer --no-pager
sudo -u postgres ls -lh /var/backups/wfm
```

Копию backup желательно выгружать во внешнее защищённое хранилище. Один диск
с сервером не является полноценной резервной копией.


## 16. Обновление из GitHub

Перед каждым обновлением:

```bash
sudo -u postgres pg_dump --format=custom \
  --file=/var/backups/wfm/wfm_before_update.dump wfm_db
sudo -u wfm -H git -C /opt/wfm/app status --short
sudo -u wfm -H git -C /opt/wfm/app fetch origin
sudo -u wfm -H git -C /opt/wfm/app rev-list --left-right --count HEAD...origin/main
sudo -u wfm -H git -C /opt/wfm/app log --oneline --decorate -5 origin/main
```

Если рабочее дерево не чистое — остановиться и выяснить происхождение файлов;
не использовать `reset --hard`/`clean -fd`. Сохранить текущий SHA отдельно.

```bash
sudo -u wfm -H git -C /opt/wfm/app rev-parse HEAD | sudo tee /var/backups/wfm/code_before_update.sha
sudo -u wfm -H git -C /opt/wfm/app pull --ff-only origin main

sudo -u wfm -H bash -c '
set -euo pipefail
cd /opt/wfm/app/backend
./venv/bin/python -m pip install -r requirements.txt
./venv/bin/python -m pip check
./venv/bin/python -m unittest discover -s tests -v
./venv/bin/python -m compileall -q app
cd /opt/wfm/app/frontend
npm ci
npm run build
'

sudo systemctl restart wfm-backend
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1:8000/health
curl --fail --silent --show-error https://wfm.example.ru/health
```

Если изменились SQLAlchemy-модели, сначала прочитать release diff и выполнить
требуемую миграцию. `create_all` добавляет новые таблицы, но не меняет колонки
существующих PostgreSQL-таблиц.


## 17. Откат

Откат кода без отката базы допустим только если новый релиз не изменил схему:

```bash
OLD_SHA=$(cat /var/backups/wfm/code_before_update.sha)
sudo systemctl stop wfm-backend
sudo -u wfm -H git -C /opt/wfm/app switch --detach "$OLD_SHA"
sudo -u wfm -H bash -c '
cd /opt/wfm/app/backend && ./venv/bin/python -m pip install -r requirements.txt
cd /opt/wfm/app/frontend && npm ci && npm run build
'
sudo systemctl start wfm-backend
sudo nginx -t && sudo systemctl reload nginx
```

Если схема/данные изменились, не восстанавливать dump поверх рабочей базы.
Сначала остановить backend, создать отдельную проверочную БД, восстановить туда
backup через `pg_restore`, проверить и только затем согласовать переключение.


## 18. Диагностика

```bash
sudo systemctl status wfm-backend nginx postgresql --no-pager
sudo journalctl -u wfm-backend -n 200 --no-pager
sudo tail -n 100 /var/log/nginx/error.log
curl -v http://127.0.0.1:8000/health
sudo -u postgres psql -d wfm_db -c "SELECT now();"
sudo ss -lntp
```

Типовые причины:

- `analytics_cache.enabled=false`: `WFM_DATABASE_URL` указывает не на
  PostgreSQL либо cache выключен env-переменной;
- 502 Nginx: backend не запущен или слушает не `127.0.0.1:8000`;
- 403 у менеджера: ему не назначен проект;
- первая историческая страница медленная: для её точного ключа ещё нет снимка;
- старый снимок: Naumen не ответил, смотреть агрегат `last_error`, не payload;
- сотрудники не обновляются: нет tracked project, проект ручной, нет Naumen
  credentials или предыдущая синхронизация ещё идёт;
- двойные задания: запущено более одного backend process/worker;
- live работает, история нет: проверить `analytics_cache`, доступ к WFM DB и
  тяжёлые исторические запросы Naumen;
- история работает, live нет: live специально идёт напрямую в Naumen —
  проверить именно текущую доступность внешнего источника.


## 19. Финальный отчёт агента

Отчёт должен содержать только несекретные сведения:

- домен/IP и HTTPS status;
- опубликованный Git SHA;
- версии Python/Node/PostgreSQL;
- `systemctl is-active` для backend/Nginx/PostgreSQL;
- результат backend tests и frontend build;
- health и `analytics_cache.enabled/backend`;
- количество проектов/сотрудников без ФИО и логинов;
- время последнего cache refresh и backup;
- что осталось заблокировано (DNS, Git, Naumen, пользовательская проверка);
- напоминание владельцу забрать admin-пароль и удалить
  `/root/wfm-bootstrap-credentials.txt`.

После успешной передачи пароля:

```bash
sudo rm -f /root/wfm-bootstrap-credentials.txt
```

Удаление осознанное: файл содержит единственную bootstrap-копию сгенерированных
секретов. Перед удалением владелец обязан подтвердить, что пароль сохранён и
вход выполнен.
