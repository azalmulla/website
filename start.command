#!/bin/bash
# Double-click to open the dashboard at http://localhost:8000
# (first time: right-click → Open, to get past the macOS security prompt)
cd "$(dirname "$0")" || exit 1
PORT=8000

# Pull the latest site changes and daily news from GitHub, if this is a git clone
if [ -d .git ]; then
  echo "Updating from GitHub…"
  git pull --quiet || echo "(couldn't update — showing the copy on this Mac)"
fi

URL="http://localhost:$PORT"
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "Already running."
  open "$URL"
  exit 0
fi

echo "Dashboard running at $URL — keep this window open; close it to stop."
(sleep 1; open "$URL") &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
