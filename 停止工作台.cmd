@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  set "ROUTER_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
) else (
  set "ROUTER_NODE=node.exe"
)
"%ROUTER_NODE%" "%~dp0launcher.mjs" --stop
if errorlevel 1 pause
