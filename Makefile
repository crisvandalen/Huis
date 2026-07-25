.PHONY: setup inventaris homey tahoma appletv dashboard schoon help

VENV := .venv
PY := $(VENV)/bin/python

help:
	@echo "make setup       - virtualenv + dependencies installeren"
	@echo "make inventaris  - Homey, TaHoma en Apple TV uitlezen naar inventaris/export/"
	@echo "make homey       - alleen Homey exporteren"
	@echo "make tahoma      - alleen TaHoma exporteren"
	@echo "make appletv     - Apple TV's scannen"
	@echo "make dashboard   - dashboard/index.html bouwen uit de exports"
	@echo "make schoon      - exports en dashboard weggooien"

setup:
	@test -f .env || (cp .env.example .env && echo "Aangemaakt: .env — vul je tokens in")
	python3 -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r scripts/requirements.txt
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

schoon:
	rm -f inventaris/export/*.json dashboard/index.html
