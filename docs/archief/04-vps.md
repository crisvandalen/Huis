# 04 — Dashboard op de VPS

Doel: het dashboard overal kunnen bekijken én verversen, zonder dat er thuis
iets aan hoeft te staan. Dit werkt omdat de Athom-cloudroute
(`https://<cloud-id>.connect.athom.com`) dezelfde API-key accepteert als de
lokale API — getest op 30-07, geeft 200.

## Architectuur

```
browser ──(https + basic auth)── nginx ── 127.0.0.1:8321 serveer.py
                                                 │  /ververs
                                                 ▼
                                  export-devices.mjs ── cloudroute ── Homey
```

De VPS praat dus rechtstreeks met Homey via Athom's cloud. De Mac is alleen
nog nodig om aan het project zelf te werken.

## Eenmalige inrichting

### 1. Repo op de VPS

```bash
git clone <jouw-git-remote> huis && cd huis
make setup                 # vereist: python3-venv, node >= 18, rsync/git
cp .env.example .env
```

In `.env` op de VPS alleen dit invullen (HOMEY_HOST leeg laten):

```
HOMEY_API_KEY=<de key>
HOMEY_CLOUD_ID=<het lange id uit de my.homey.app-url>
```

Test: `make homey` — hoort "proberen https://….connect.athom.com … werkt" te
tonen. Daarna `make dashboard`.

### 2. serveer.py als service

`/etc/systemd/system/huis-dashboard.service`:

```ini
[Unit]
Description=Huis-dashboard (serveer.py)
After=network-online.target

[Service]
User=cris
WorkingDirectory=/home/cris/huis
ExecStart=/home/cris/huis/.venv/bin/python scripts/serveer.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now huis-dashboard
```

### 3. nginx ervoor, mét wachtwoord

Het dashboard toont of de deur op slot is en of er iemand thuis lijkt —
**nooit zonder authenticatie op internet zetten.**

```bash
sudo htpasswd -c /etc/nginx/.htpasswd cris
```

```nginx
server {
    listen 443 ssl;                    # certbot regelt de certificaten
    server_name huis.<domein>;
    auth_basic "Huis";
    auth_basic_user_file /etc/nginx/.htpasswd;
    location / {
        proxy_pass http://127.0.0.1:8321;
    }
}
```

## Dagelijks gebruik

- Pagina openen → ↻ Ververs → de VPS haalt zelf verse data bij Homey.
- Optioneel automatisch vers: `crontab -e` →
  `*/30 * * * * cd ~/huis && make homey dashboard >/dev/null 2>&1`
- Code-updates: op de Mac `git push`, op de VPS `git pull` (of dat ook in cron).

## Beperkingen

- De cloudroute loopt via Athom; is hun cloud stuk, dan faalt verversen
  (nette foutmelding in de knop). Thuis blijft alles gewoon werken.
- `make tahoma` en `make appletv` zijn thuisnetwerk-dingen; die draai je op
  de Mac, niet op de VPS.
