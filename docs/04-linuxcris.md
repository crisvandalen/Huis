# 04 — linuxcris: de always-on thuisserver

Sinds augustus 2026 draait alles wat "altijd aan" moet zijn op **linuxcris**,
een Ubuntu-server op het thuisnetwerk. Dit vervangt de eerdere Hetzner-VPS
("het brein", `46.62.194.166`), die op 5 aug 2026 is opgezegd. De oude
VPS-documenten staan in `docs/archief/`.

Groot voordeel t.o.v. de VPS: linuxcris zit **op het LAN**, dus de scripts
praten weer rechtstreeks met Homey via de lokale API — geen cloud-OAuth-omweg
meer nodig. En anders dan de Mac (die slaapt) staat hij 24/7 aan.

## Bereikbaarheid

| | Thuis (LAN) | Onderweg (Tailscale) |
| --- | --- | --- |
| SSH | `ssh cris@192.168.2.196` | `ssh cris@100.117.180.2` |
| Huis-dashboard | http://192.168.2.196:8765 | http://100.117.180.2:8765 |
| PWA + HTTPS (iPhone) | — | https://linuxcris.taile5370e.ts.net/ |

- Vast IP **192.168.2.196** (LAN `192.168.2.0/24`), Tailscale **100.117.180.2**,
  tailnet-hostnaam `linuxcris.taile5370e.ts.net` (geldig cert via `tailscale serve`).
- Firewall (ufw): alleen LAN + Tailscale, **geen poorten naar internet**.
  fail2ban + unattended-upgrades staan aan.
- Hostname `linuxcris`, gebruiker `cris`, Ubuntu 26.04 LTS.

## Wat er draait

- **Huis-dashboard** uit de git-repo `~/huis` (GitHub `crisvandalen/Huis`).
  systemd-service `huis-dashboard` (`serveer.py`) op `0.0.0.0:8765`
  (env `HUIS_HOST=0.0.0.0`, `HUIS_POORT=8765`). Cron elk heel uur:
  `git pull` + `make homey dashboard` -> log `~/cron-huis.log`.
- Node.js + Python-venv staan er; `.env` met `HOMEY_HOST` / `HOMEY_API_KEY` is
  meegemigreerd (geheimen niet in git).
- Naast huis draait er een lokale AI-stack (Ollama op de GPU, Open WebUI :3000,
  n8n :5678) — los van dit project; zie de second-brain-notities `Linux_cris*`.

## Dashboard bijwerken en bekijken

De cron doet het uurlijks vanzelf. Handmatig:

```bash
ssh cris@192.168.2.196
cd ~/huis && git pull && make homey dashboard
systemctl status huis-dashboard        # draait de webserver?
tail -20 ~/cron-huis.log               # ging de laatste verversing goed?
```

Bekijken: `http://192.168.2.196:8765` (thuis) of via Tailscale onderweg.

## Code en secrets bijwerken

- **Code:** op de Mac `git push`; op linuxcris pakt de uur-cron het via
  `git pull` vanzelf op (of handmatig `cd ~/huis && git pull`).
- **Secrets** (`.env`, tokens): NIET via git. Met scp overzetten, bijv.
  `scp .env cris@192.168.2.196:~/huis/.env`.

## Waarom niet meer via de cloud

Op de VPS moest de Homey-export via de Athom-cloud (`export-cloud.mjs`), omdat
de VPS buiten het thuisnetwerk stond. linuxcris zit op het LAN, dus de **lokale**
export (`make homey` -> `export-devices.mjs`) werkt weer en is de standaard. De
cloud-route blijft als fallback bestaan (zie `docs/archief/04-cloud-oauth2.md`),
mocht er ooit weer een off-LAN draai-omgeving nodig zijn.

## Beperkingen

- **Single point of failure:** sinds de VPS weg is, is er geen off-site
  omgeving meer. Voor de dashboard-data niet erg (Homey blijft de bron), maar
  bij stroom- of internetuitval thuis valt het dashboard stil. Acceptabel voor
  privegebruik.
- `make tahoma` en `make appletv` zijn ook thuisnetwerk-dingen; die kunnen nu
  net zo goed op linuxcris draaien als op de Mac.

Zie ook ADR `docs/adr/0004-always-on-linuxcris.md`.
