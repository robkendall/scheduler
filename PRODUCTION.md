# Scheduler Production Setup Guide

## Render Services
- `scheduler-api` (Node web service)
- `scheduler-frontend` (Static site)

## Neon Database
- Use a Neon Postgres instance named `scheduler_prod`.
- Set the `DATABASE_URL` in Render to the Neon connection string.

## Environment Variables
- See `api/.env.example` and `frontend/.env.example` for required variables.
- Set secrets (like `SESSION_SECRET`) in Render dashboard, not in repo.

## Production Docker Compose
- Use `docker-compose.prod.yml` for local production builds.
- Use `Caddyfile.prod` for local reverse proxy (optional).

## Deployment
- Use Render for production deployments.
- For local prod: `./scripts/deploy-prod.sh` (requires `.env.production` file).

## Notes
- Health checks: `/healthz` for API, `/` for frontend.
- All static routes are rewritten to `/index.html` for SPA support.
