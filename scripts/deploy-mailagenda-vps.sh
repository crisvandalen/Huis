#!/usr/bin/env bash
# Kopieert de door Cowork gemaakte mail/agenda- (en camera-log-) export naar de
# VPS en herbouwt daar het dashboard. Zo toont de VPS-versie ook Mail & agenda
# en Vannacht. Draai dit vanaf de MacBook, vlak na de ochtend-verversing
# (bijv. via cron om 07:10). mail-agenda.json + ring-log.json zijn git-ignored,
# dus ze gaan bewust NIET via git maar via scp.
set -euo pipefail

# VPS-adres (overschrijfbaar met: export VPS_HOST=cris@ander-ip)
VPS="${VPS_HOST:-cris@46.62.194.166}"
VPS_DIR="projects/huis"          # pad op de VPS, t.o.v. de home van cris
LOKAAL="$HOME/projects/Prive/huis/inventaris/export"

for f in mail-agenda.json ring-log.json; do
  if [ -f "$LOKAAL/$f" ]; then
    scp -q "$LOKAAL/$f" "$VPS:$VPS_DIR/inventaris/export/$f" && echo "-> $f gekopieerd naar de VPS"
  fi
done

# Herbouw direct op de VPS (alleen de generator; cloud-export is niet nodig).
ssh "$VPS" "cd $VPS_DIR && /usr/bin/make dashboard" && echo "VPS-dashboard herbouwd"
