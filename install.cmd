@echo off
rem ALLINONE-AGENT installer wrapper.
rem Launches install.ps1 with ExecutionPolicy Bypass scoped to THIS PROCESS ONLY -
rem does not change the system or user's default PowerShell execution policy.
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1" %*
exit /b %ERRORLEVEL%
