#!/bin/bash
# 네컷 사진관 실행 (macOS) - 기본 프린터로 대화상자 없이 바로 인쇄
# GitHub 사이트 주소를 넣으세요. 비워 두면 이 폴더의 index.html을 엽니다.
BOOTH_URL=""
DIR="$(cd "$(dirname "$0")" && pwd)"
[ -z "$BOOTH_URL" ] && BOOTH_URL="file://$DIR/index.html"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.fourcut-booth" --kiosk --kiosk-printing \
  --use-fake-ui-for-media-stream --disable-pinch --overscroll-history-navigation=0 \
  --no-first-run --autoplay-policy=no-user-gesture-required "$BOOTH_URL" >/dev/null 2>&1 &
