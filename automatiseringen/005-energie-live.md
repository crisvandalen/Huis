# 005 — Live energie-beeld (op linuxcris)

**Status:** gebouwd
**Draait op:** script (`scripts/homey/export-energie-live.mjs`, --loop) als systemd-service + statische pagina `dashboard/energie.html`

## Wat moet het doen

Continu (elke 30 s) je actuele stroom laten zien — verbruik, zon, afname/teruglevering en de huidige Vattenfall FlexPrijs — met een indicatief "batterij zou nu laden/ontladen"-signaal.

## Waarom

Het gewone dashboard is een momentopname per uur. Voor gevoel bij dynamische prijzen en een batterij wil je *nu* zien: lever ik terug terwijl stroom bijna niets kost, of neem ik af terwijl het duur is? Dat is precies wat een batterij zou verschuiven.

## Trigger

Een always-on poller op linuxcris (systemd-service met `--loop`, interval 30 s). De pagina in de browser haalt elke 30 s `energie-live.json` op en hertekent.

## Actie

1. `export-energie-live.mjs` leest via de Athom-cloud (`maakHomeyApi`) de slimme meter (`11df88ce`, `measure_power` + dag/totaal-tellers) en de Enphase (`6e19c3c8`, `measure_power` = zon nu, `meter_power.day` = zon vandaag).
2. Haalt de EPEX-uurprijzen van vandaag op bij EnergyZero (kale marktprijs incl. btw) en rekent ze om naar all-in FlexPrijs: `markt + energiebelasting + Vattenfall-opslag`.
3. Schrijft `dashboard/energie-live.json` (momentopname + prijzen van vandaag + batterij-advies).
4. `dashboard/energie.html` (statisch) leest dat bestand en ververst zichzelf; linuxcris serveert beide uit de statische map (`:8766`) achter LAN + Tailscale, net als het dashboard.

### .env (op linuxcris aanvullen)

```
FLEX_OPSLAG_KWH=0.02      # Vattenfall FlexPrijs inkoopvergoeding, EUR/kWh incl btw
ENERGIEBELASTING=0.1316   # energiebelasting elektriciteit 2026, EUR/kWh incl btw
TERUGLEVER_KWH=0.05       # terugleververgoeding (na saldering), EUR/kWh
```

Vul de exacte opslag/vergoeding uit je Vattenfall-contract in; de defaults zijn richtwaarden.

### systemd-service

`/etc/systemd/system/huis-energie.service`:

```ini
[Unit]
Description=Huis live-energie poller
After=network-online.target

[Service]
User=cris
WorkingDirectory=/home/cris/huis
ExecStart=/usr/bin/node scripts/homey/export-energie-live.mjs --loop
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now huis-energie
journalctl -u huis-energie -f      # meekijken
```

### Serveren op linuxcris

De live pagina en het JSON zijn statische bestanden uit `dashboard/`; die worden
uit de statische map geserveerd (poort 8766, niet via serveer.py), achter LAN +
Tailscale:

```nginx
location /energie {
    alias /home/cris/huis/dashboard/energie.html;
    default_type text/html;
}
location = /energie-live.json {
    alias /home/cris/huis/dashboard/energie-live.json;
    add_header Cache-Control "no-store";
}
```

Openen: `http://192.168.2.196:8766/energie.html` (thuis) of via Tailscale `https://linuxcris.taile5370e.ts.net/energie.html`.

## Ontsnapping

Puur uitlezen, stuurt niets aan — niets te overrulen. Stoppen: `sudo systemctl disable --now huis-energie`.

## Randgevallen

- **Enphase niet in Insights/cloud** — `measure_power` (zon nu) komt wél via de cloud binnen; historische zon niet (los probleem, zie export-insights). Is `zon_w` null, dan toont de tile een streepje.
- **Cloud/sessie valt weg** — een mislukte tik wordt gelogd en overgeslagen; de pagina toont de laatst bekende data plus een foutbalk als het JSON te oud/onbereikbaar is. `Restart=on-failure` vangt een harde crash.
- **EnergyZero onbereikbaar** — prijzen vallen terug op de laatste cache; vermogen blijft gewoon updaten.
- **Sign-conventie meter** — `measure_power` positief = afname, negatief = teruglevering (HomeWizard). Klopt dit bij jou niet, draai dan het teken in `snapshot()`.
- **Herstart linuxcris** — systemd start de service vanzelf weer.

## Testen

Op linuxcris eenmalig: `node scripts/homey/export-energie-live.mjs` (zonder `--loop`) — moet een regel loggen met net-vermogen, zon en prijs, en `dashboard/energie-live.json` schrijven. Open daarna `/energie`: tiles vullen zich, de prijsgrafiek toont vandaag met nu-marker en goedkoopste/duurste uur. Zet 's middags met zon een grote verbruiker aan/uit en kijk of `net_w` mee beweegt.

## Openstaande vragen

- [ ] Exacte Vattenfall-opslag en energiebelasting 2026 invullen in `.env`.
- [ ] Meterteken (`measure_power`) verifiëren met een bekende situatie (alles uit → klein positief; zon-overschot → negatief).
- [ ] Later: today-totalen voor import/teruglevering apart (nu tonen we netto dagverbruik + zon vandaag).
