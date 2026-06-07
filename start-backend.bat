@echo off
echo === WFM Телесейлз-Сервис — Backend ===
cd /d "%~dp0backend"

if not exist ".env" (
    echo Копирую .env.example → .env
    copy .env.example .env
    echo ВАЖНО: Заполни .env данными Naumen, затем перезапусти!
    pause
)

if not exist "venv" (
    echo Создаю виртуальное окружение...
    python -m venv venv
)

call venv\Scripts\activate.bat
echo Устанавливаю зависимости...
pip install -r requirements.txt -q

echo.
echo Запускаю FastAPI на http://localhost:8000
echo Документация API: http://localhost:8000/docs
echo Для остановки нажми Ctrl+C
echo.
python run.py
