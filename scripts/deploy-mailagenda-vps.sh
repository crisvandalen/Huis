#!/usr/bin/env bash
# Kopieert de door Cowork gemaakte mail/agenda- (en camera-log-) export naar de
# VPS en herbouwt daar het dashboard. Zo toont de VPS-versie ook Mail & agenda
# en Vannacht. Draai dit vanaf de MacBook, vlak na de ochtend-verversing
# (bijv. via launchd om 07:10). mail-agenda.json + ring-log.json zijn
# git-ignored, dus ze gaan bewust NIET via git maar via scp.
set -euo pipefail

# Vul je VPS in (host of user@ip), of zet de omgevingsvariabele VPS_HOST.
VPS="${VPS_HOST:-cris@JOUW_VPS_IP}"
VPS_DIR="projects/huis"          # pad op de VPS (t.o.v. home)
LOKAAL="$HOME/projects/Prive/huis/inventaris/export"

if [[ "$VPS" == *JOUW_VPS_IP* ]]; then
  echo "Stel eerst je VPS in: bovenin dit script, of 'export VPS_HOST=cris@1.2.3.4'." >&2
  exit 1
fi

for f in mail-agenda.json ring-log.json; do
  if [ -f "$LOKAAL/$f" ]; then
    scp -q "$LOKAAL/$f" "$VPS:$VPS_DIR/inventaris/export/$f" && echo "-> $f gekopieerd naar de VPS"
  fi
done

# Herbouw direct op de VPS (alleen de generator; cloud-export is niet nodig).
ssh "$VPS" "cd $VPS_DIR && /usr/bin/make dashboard" && echo "VPS-dashboard herbouwd"
