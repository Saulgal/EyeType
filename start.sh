#!/usr/bin/env bash
# EyeType — macOS / Linux launcher

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE="$SCRIPT_DIR/index.html"

open_in_chrome() {
  if command -v google-chrome &>/dev/null; then
    google-chrome --allow-file-access-from-files "$FILE" &
  elif command -v google-chrome-stable &>/dev/null; then
    google-chrome-stable --allow-file-access-from-files "$FILE" &
  elif command -v chromium-browser &>/dev/null; then
    chromium-browser --allow-file-access-from-files "$FILE" &
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if [ -d "/Applications/Google Chrome.app" ]; then
      open -a "Google Chrome" --args --allow-file-access-from-files "$FILE"
    elif [ -d "/Applications/Microsoft Edge.app" ]; then
      open -a "Microsoft Edge" --args --allow-file-access-from-files "$FILE"
    else
      open "$FILE"
    fi
  else
    xdg-open "$FILE"
  fi
}

echo "🧿 EyeType — Launching..."
open_in_chrome

echo ""
echo "If the camera is blocked, try manually opening:"
echo "  $FILE"
echo "in Chrome with --allow-file-access-from-files flag."
