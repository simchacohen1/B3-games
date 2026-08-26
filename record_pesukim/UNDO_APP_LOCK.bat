@echo off
cd /d "%~dp0"
echo.
echo Posuk Practice App Lock - UNDO
echo =============================
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py undo_app_lock.py
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python undo_app_lock.py
  goto :end
)
echo Python was not found.
pause
:end
