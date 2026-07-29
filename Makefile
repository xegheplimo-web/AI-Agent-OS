.PHONY: help dev build start lint typecheck test verify db-push db-seed db-studio worker worker-prod audit-verify demo-up demo-down prod-up prod-down logs

help:
	@echo "AI Agent OS — control plane"
	@echo ""
	@echo "  make dev            next dev (APP_MODE from .env)"
	@echo "  make verify         lint + typecheck + test + build"
	@echo "  make db-push        apply schema (uses DATABASE_URL)"
	@echo "  make db-seed        demo data (blocked when APP_MODE=production)"
	@echo "  make worker         worker in the mode from .env"
	@echo "  make worker-prod    worker with the REAL auditor engine"
	@echo "  make audit-verify   run the real engine once and check artifacts"
	@echo "  make demo-up        docker: migrate + seed + dashboard (no worker)"
	@echo "  make prod-up        docker: migrate + dashboard + worker"

dev:           ; npm run dev
build:         ; npm run build
start:         ; npm run start
lint:          ; npm run lint
typecheck:     ; npm run typecheck
test:          ; npm run test
verify:        ; npm run verify

db-push:       ; npm run db:push
db-seed:       ; npm run db:seed
db-studio:     ; npm run db:studio

worker:        ; npm run worker
worker-prod:   ; APP_MODE=production npm run worker
audit-verify:  ; npm run audit:verify

# --- docker: profiles are mutually exclusive -------------------------------
demo-up:       ; docker compose --profile demo up --build -d
demo-down:     ; docker compose --profile demo down
prod-up:       ; docker compose --profile production up --build -d
prod-down:     ; docker compose --profile production down
logs:          ; docker compose logs -f --tail=100
