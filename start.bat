@echo off
title OmniBot SaaS Launcher
color 0A

echo.
echo  ================================================
echo    OmniBot SaaS  -  Starting dev servers...
echo  ================================================
echo.

:: Check backend venv
if not exist "%~dp0backend\venv\Scripts\activate.bat" (
    echo  [ERROR] Backend venv not found.
    echo.
    echo  Fix: cd backend
    echo       python -m venv venv
    echo       venv\Scripts\activate
    echo       pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

:: Check frontend node_modules
if not exist "%~dp0frontend\node_modules" (
    echo  [ERROR] frontend\node_modules not found.
    echo.
    echo  Fix: cd frontend
    echo       npm install
    echo.
    pause
    exit /b 1
)

:: Start backend in a new window
echo  [1/2] Starting FastAPI backend  ...  http://localhost:8000
start "OmniBot - Backend" cmd /k "cd /d "%~dp0backend" && call venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

:: Give backend a 2-second head-start
timeout /t 2 /nobreak >nul

:: Start frontend in a new window
echo  [2/2] Starting Next.js frontend ...  http://localhost:3000
start "OmniBot - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo  ================================================
echo    Servers are running in two new windows.
echo.
echo    Backend   -  http://localhost:8000
echo    Frontend  -  http://localhost:3000
echo    API Docs  -  http://localhost:8000/docs
echo  ================================================
echo.
echo  Close the two server windows to stop everything.
echo  Press any key to close this launcher...
pause >nul
