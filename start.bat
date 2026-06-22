@echo off
rem ============================================================
rem  WFM Telesales-Service - launch backend + frontend
rem  Backend : http://localhost:8000  (docs: /docs)
rem  Frontend: http://localhost:5173
rem ============================================================
start "WFM Backend"  cmd /k "%~dp0start-backend.bat"
start "WFM Frontend" cmd /k "%~dp0start-frontend.bat"
echo Two windows opened: backend (8000) and frontend (5173).
