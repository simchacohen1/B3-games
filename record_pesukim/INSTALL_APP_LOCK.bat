@echo off
cd /d "%~dp0"
echo.
echo Posuk Practice App Lock Installer
echo ================================
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py install_app_lock.py
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python install_app_lock.py
  goto :end
)
echo Python was not found.
pause
:end
