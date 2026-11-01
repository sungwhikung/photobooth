@echo off
REM ===== Four-cut photo booth launcher (Windows) =====
REM Put your GitHub Pages address below, e.g.
REM   set "BOOTH_URL=https://myid.github.io/photobooth/"
REM Leave it empty to open index.html in this folder instead.
set "BOOTH_URL=https://sungwhikung.github.io/photobooth/"

REM --kiosk-printing : print straight to the DEFAULT printer (Canon SELPHY) without a dialog
REM --use-fake-ui-for-media-stream : allow the camera without asking
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Google Chrome was not found. Please install Chrome first.
  pause
  exit /b
)
if "%BOOTH_URL%"=="" set "BOOTH_URL=file:///%~dp0index.html"
start "" "%CHROME%" --user-data-dir="%LocalAppData%\FourCutBooth" --kiosk --kiosk-printing --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --disable-pinch --overscroll-history-navigation=0 --no-first-run --no-default-browser-check --noerrdialogs --disable-session-crashed-bubble --disable-features=Translate,TranslateUI "%BOOTH_URL%"
