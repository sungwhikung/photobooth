@echo off
REM ===== Four-cut photo booth launcher (Windows) =====
REM 1) Put your GitHub Pages address below, e.g.  set "BOOTH_URL=https://myid.github.io/photobooth/"
REM    Leave it empty to open the local index.html in this folder (QR then links straight to the photo file).
set "BOOTH_URL="

REM --kiosk-printing : print immediately to the DEFAULT printer (Canon SELPHY) without a dialog
REM --use-fake-ui-for-media-stream : auto-allow the camera permission
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Google Chrome not found. Please install Chrome.
  pause
  exit /b
)
if "%BOOTH_URL%"=="" set "BOOTH_URL=file:///%~dp0index.html"
start "" "%CHROME%" --user-data-dir="%LocalAppData%\FourCutBooth" --kiosk --kiosk-printing --use-fake-ui-for-media-stream --disable-pinch --overscroll-history-navigation=0 --no-first-run --autoplay-policy=no-user-gesture-required "%BOOTH_URL%"
