#!/bin/bash
set -e

REPO_URL="${REPO_URL:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

if [ -z "$REPO_URL" ] || [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: REPO_URL and GITHUB_TOKEN must be set"
  exit 1
fi

# Use token inside remote URL
AUTH_URL=$(echo "$REPO_URL" | sed "s|https://|https://x-access-token:${GITHUB_TOKEN}@|")

if [ -d .git ]; then
  git remote remove origin 2>/dev/null || true
  git remote add origin "$AUTH_URL"
else
  git init
  git remote add origin "$AUTH_URL"
fi

git add .
git commit -m "feat: Nader Pay Agent v1" || true
git branch -M main
git push -u origin main --force
