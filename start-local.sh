#!/usr/bin/env bash
# Запуск Compresso v3 на этой машине. Двойной клик не нужен — в Terminal:
#   bash start-local.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "Папка проекта: $(pwd)"

if [[ ! -f package.json ]]; then
  echo "Нет package.json. Распакуйте архив целиком и запускайте скрипт из папки compresso-v2."
  exit 1
fi

if ! grep -q "Анимация" src/components/Layout/Tabs.tsx; then
  echo "Это старая сборка без вкладки «Анимация». Нужен архив compresso-v3-with-animation.zip."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Нет Node.js. Установите LTS с https://nodejs.org/ и откройте Terminal заново."
  exit 1
fi

echo "Node $(node -v)"

for port in 5173 5174 5175; do
  pids="$(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Останавливаю старый процесс на порту ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
    sleep 0.3
    kill -9 ${pids} 2>/dev/null || true
  fi
done

echo "npm install…"
npm install

echo
echo "Откроется http://127.0.0.1:5173/"
echo "Старые вкладки :5174 закройте. Ждите строку Local, не открывайте GitHub Pages."
echo

if command -v open >/dev/null 2>&1; then
  (
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      if curl -sf -o /dev/null http://127.0.0.1:5173/ 2>/dev/null; then
        open "http://127.0.0.1:5173/"
        exit 0
      fi
      sleep 0.4
    done
  ) &
fi

exec npx vite --host 127.0.0.1 --port 5173 --strictPort --clearScreen false
