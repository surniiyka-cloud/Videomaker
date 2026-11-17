@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
 echo Требуется Python 3: https://www.python.org/downloads/
 pause
 exit /b 1
)
py -m pip install -r requirements-bridge.txt
if errorlevel 1 (
 echo Не удалось установить requests
 pause
 exit /b 1
)
py launch_studio.py
pause
