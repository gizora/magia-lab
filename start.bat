@echo off
cd /d "%~dp0"
where node > nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js and run this file again.
  echo You can still play by opening index.html, but the browser will ask for microphone permission every time.
  pause
  exit /b 1
)
echo Magia Lab: http://localhost:8765/
echo Closing this window stops the game server.
node server.js --open
pause
