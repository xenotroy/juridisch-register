@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 pipeline\serve.py --port 8846 --open
) else (
  python pipeline\serve.py --port 8846 --open
)
pause
