@echo off
title Pointer Lab (isolated test copy - close this window to stop it)
cd /d "%~dp0\..\.."
node scripts\pointer-lab\start-lab.cjs --open
pause
