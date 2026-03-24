#!/usr/bin/env sh
set -eu

REPO_DIR=${1:-"$PWD"}

cd "$REPO_DIR"

echo "Deploying latest main branch..."
git fetch origin main
git checkout main
git reset --hard origin/main

echo "Building and starting production services..."
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --remove-orphans

echo "Pruning dangling images..."
docker image prune -f

echo "Deployment complete."
