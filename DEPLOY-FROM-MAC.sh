#!/usr/bin/env bash
# Deploy Compresso v3 to GitHub Pages from your Mac.
# Run inside your local clone that has a `github` (or `origin`) remote
# pointing at elanoides/compresso-v2.
set -euo pipefail

REMOTE="${1:-github}"
BRANCH=main

echo "Remotes:"
git remote -v
echo

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "Remote «$REMOTE» not found. Try: bash DEPLOY-FROM-MAC.sh origin"
  exit 1
fi

if ! grep -q 'Анимация' src/components/Layout/Tabs.tsx 2>/dev/null; then
  echo "This folder has no Animation tab — unpack compresso-v3-deploy.zip first."
  exit 1
fi

git add -A
if git diff --cached --quiet; then
  echo "No new file changes to commit (OK if you already committed)."
else
  git commit -m "Deploy Compresso v3: animation keyframes and step morph"
fi

echo "Force-pushing to $REMOTE/$BRANCH (Pages workflow runs on push)…"
git push "$REMOTE" "HEAD:$BRANCH" --force

echo
echo "Open https://github.com/elanoides/compresso-v2/actions"
echo "When green, site: https://elanoides.github.io/compresso-v2/"
