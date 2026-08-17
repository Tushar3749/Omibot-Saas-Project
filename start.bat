@echo off
cd /d D:\OmniBot-SaaS
echo Clearing frontend cache...
rmdir /s /q frontend\.next 2>nul
echo Starting Backend...
start "OmniBot Backend" cmd /k "cd /d D:\OmniBot-SaaS\backend && "C:\Users\GB DATA\AppData\Local\Programs\Python\Python310\python.exe" -m uvicorn app.main:app --port 8001"
timeout /t 5 /nobreak >nul
echo Starting Frontend...
start "OmniBot Frontend" cmd /k "cd /d D:\OmniBot-SaaS\frontend && echo NEXT_PUBLIC_API_URL=http://localhost:8001>.env.local && npm run dev"
echo Done! Backend: 8001, Frontend: 3000