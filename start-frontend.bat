@echo off
echo === WFM Телесейлз-Сервис — Frontend ===
cd /d "%~dp0frontend"

if not exist "node_modules" (
    echo Устанавливаю зависимости npm...
    npm install
)

echo.
echo Запускаю React на http://localhost:5173
echo Для остановки нажми Ctrl+C
echo.
npm run dev
