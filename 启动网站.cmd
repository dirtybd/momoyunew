@echo off
setlocal
chcp 65001 >nul
title Momoyu - Website
pushd "%~dp0"
if errorlevel 1 goto failed
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Please install it first.
  goto failed
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo Your Node.js version is too old. Node.js 24 or newer is required.
  goto failed
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing dependencies for the first launch...
  call npm install
  if errorlevel 1 goto failed
)
echo.
echo Website: http://127.0.0.1:5174/
echo Starting Momoyu. Please keep this window open while using the website.
node scripts/dev.mjs --open
if errorlevel 1 goto failed
echo.
echo Website: http://127.0.0.1:5174/
echo If the browser did not appear, copy the address above into your browser.
pause
popd
exit /b 0

:failed
echo.
echo Startup failed. Please read the error above or share a screenshot.
pause
popd
exit /b 1
