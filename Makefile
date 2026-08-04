.PHONY: setup inventaris homey tahoma appletv dashboard serve publiceer schoon help energie kosten kosten-data zon laadpaal laadadvies

VENV := .venv
PY := $(VENV)/bin/python

help:
	@echo "make setup       - virtualenv + dependencies installeren"
	@echo "make inventaris  - Homey, TaHoma en Apple TV uitlezen naar inventaris/export/"
	@echo "make homey       - alleen Homey exporteren"
	@echo "make tahoma      - alleen TaHoma exporteren"
	@echo "make appletv     - Apple TV's scannen"
	@echo "make dashboard   - dashboard/index.html bouwen uit de exports"
	@echo "make serve       - dashboard serveren op localhost:8321 met ververs-knop"
	@echo "make publiceer   - verse export + dashboard naar de VPS sturen (VPS_DOEL in .env)"
	@echo "make schoon      - exports en dashboard weggooien"
	@echo "make energie     - poller + live energiepagina op localhost:8080 (Ctrl+C stopt)"
	@echo "make kosten      - kosten/opbrengsten bijwerken en overzicht openen"
	@echo "make kosten-data - alleen het kostenlogboek bijwerken (geen server; naast make energie)"
	@echo "make zon         - zonproductie uit Enphase Enlighten backfillen + kosten bijwerken"
	@echo "make laadpaal    - 50five-laadsessies importeren + kostenoverzicht bijwerken"
	@echo "make laadadvies  - goedkoopste/negatieve laaduren van vandaag+morgen bepalen"

setup:
	@test -f .env || (cp .env.example .env && echo "Aangemaakt: .env — vul je tokens in")
	python3 -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r scripts/requirements.txt
	@test -f package.json && npm install --no-fund --no-audit || true
	@echo "Klaar. Vul nu .env in (HOMEY_HOST en HOMEY_API_KEY)."

inventaris: homey tahoma appletv
	@echo "Inventarisatie klaar. Zie inventaris/export/"

homey:
	node scripts/homey/export-devices.mjs

tahoma:
	$(PY) scripts/tahoma/export_setup.py

appletv:
	$(PY) scripts/appletv/scan_appletv.py

dashboard:
	$(PY) scripts/bouw_dashboard.py

serve:
	$(PY) scripts/serveer.py

publiceer: homey dashboard
	@set -a; . ./.env; set +a; \
	if [ -z "$$VPS_DOEL" ]; then echo "VPS_DOEL ontbreekt in .env"; exit 1; fi; \
	rsync -az dashboard/index.html "$$VPS_DOEL" && echo "Gepubliceerd naar $$VPS_DOEL"

schoon:
	rm -f inventaris/export/*.json dashboard/index.html

cloud-auth: ## Eenmalig inloggen bij Athom-cloud (OAuth2)
	node scripts/homey/cloud-auth.mjs $(CODE)

cloud-test: ## Test de cloud-verbinding met Homey
	node scripts/homey/cloud-test.mjs

cloud-export: ## Homey via de cloud exporteren (werkt ook op de VPS)
	node scripts/homey/export-cloud.mjs

cloud-dashboard: cloud-export dashboard ## cloud-export + dashboard bouwen (voor de VPS-cron)

router: ## Teltonika-router uitlezen naar inventaris/export/router.json (thuis draaien)
	node scripts/netwerk/router-teltonika.mjs

energie: ## poller + live energiepagina, samen starten en stoppen
	@echo "Start poller + live pagina -> http://localhost:8080/energie.html  (Ctrl+C stopt beide)"
	@node scripts/homey/export-energie-live.mjs --loop & \
	POLLER=$$!; trap 'kill $$POLLER 2>/dev/null' EXIT INT TERM; \
	(sleep 3 && command -v open >/dev/null && open http://localhost:8080/energie.html) & \
	python3 -m http.server 8080 --directory dashboard

kosten: ## kosten/opbrengsten bijwerken uit meterdata + prijzen, en het overzicht openen
	@node scripts/homey/kosten-bijwerken.mjs
	@(sleep 2 && command -v open >/dev/null && open http://localhost:8080/kosten.html) & \
	python3 -m http.server 8080 --directory dashboard

kosten-data: ## alleen bijwerken (geen server) — handig naast een draaiende make energie
	node scripts/homey/kosten-bijwerken.mjs

zon: ## Enphase Enlighten-dagproductie ophalen en het kostenoverzicht bijwerken
	node scripts/homey/enphase-enlighten.mjs
	node scripts/homey/kosten-bijwerken.mjs

laadpaal: ## 50five-laadsessies (xlsx in inventaris/import/50five/) importeren + kosten bijwerken
	$(PY) scripts/50five/laadpaal_import.py
	node scripts/homey/kosten-bijwerken.mjs

laadadvies: ## goedkoopste/negatieve laaduren (vandaag+morgen) bepalen -> dashboard/laadadvies.json
	node scripts/homey/laadadvies.mjs

.PHONY: app-deploy
app-deploy: ## hele dashboard-map (PWA + pagina's + assets) naar de VPS-webroot rsyncen
	@set -a; . ./.env; set +a; \
	if [ -z "$$VPS_WEBROOT" ]; then echo "VPS_WEBROOT ontbreekt in .env (bijv. cris@46.62.194.166:/var/www/huis/)"; exit 1; fi; \
	rsync -az --exclude='_to_delete' dashboard/ "$$VPS_WEBROOT" && echo "App gepubliceerd naar $$VPS_WEBROOT"
