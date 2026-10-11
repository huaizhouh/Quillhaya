#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先 conda activate toefl-writing-assistant。" >&2
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("需要 Node.js 22.12 或以上版本"); process.exit(1); }'
if [[ ! -d node_modules ]] || [[ ! -f node_modules/electron/path.txt ]] || [[ ! -f node_modules/.twa-lock ]] || ! cmp -s package-lock.json node_modules/.twa-lock; then
  npm ci
  cp package-lock.json node_modules/.twa-lock
fi
exec npm run dev
