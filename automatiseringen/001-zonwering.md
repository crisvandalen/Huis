# 001 — Zonwering serre op zon, wind en temperatuur

**Status:** gespecificeerd
**Draait op:** Homey advanced flow (ADR 0002)

## Situatie

Eén scherm: knikarmscherm "Serre", io-homecontrol (met terugkoppeling),
gevel **ONO (67°)**. Locatie Waardenburg (51.835 N / 5.251 O). De zon staat
op deze gevel van zonsopgang tot ca. **13:30**; daarna is het een
schaduwgevel. Zonstand-triggers komen uit de app **Zonnestanden** die al in
Homey draait.

## Wat moet het doen

Het serre-scherm sluiten tijdens zonnige, warme ochtenden en weer openen
zodra de zon de gevel rond 13:30 verlaat — met wind altijd als noodrem.

## Waarom

Handmatig bedienen gebeurt te laat: tegen de tijd dat het opvalt is het al
warm. Andersom blijven schermen dicht op momenten dat je juist licht en uitzicht
wil.

## Trigger

**Sluiten (ochtend):** zon-elevatie boven ~10° (Zonnestanden), én
buitentemperatuur boven de drempel, én geen zware bewolking.

**Openen (middag):** zonazimut passeert ~157° (zon draait van de gevel af,
rond 13:30) — of eerder, zodra het bewolkt raakt.

Wind heeft een eigen, altijd actieve trigger die alles overruled.

## Voorwaarden

| Voorwaarde | Waarde | Waarom |
| --- | --- | --- |
| Windsnelheid onder | *invullen* km/u | markiezen en uitvalschermen zijn windgevoelig |
| Buitentemperatuur boven | ~22 °C | onder die grens is opwarming welkom |
| Bewolking onder | ~60 % | zonder directe zon heeft sluiten geen zin |
| Handbediening in de afgelopen | 2 uur | een mens die zelf iets zette wint |
| Iemand thuis | ja/nee | leeg huis mag agressiever sluiten |

## Actie

1. **Sluiten:** scherm naar de My-positie (`my_value` = 105) — die stand is
   er al en is kennelijk de gewenste.
2. **Openen:** scherm helemaal in zodra de zon de gevel verlaat (azimut
   ~157°) of bij aanhoudende bewolking.
3. Status controleren via `windowcoverings_state` (io geeft terugkoppeling);
   wijkt de stand af van wat de flow stuurde, dan heeft iemand handbediend →
   2 uur niets doen.

## Ontsnapping

Handbediening wint altijd, en zet de automatisering 2 uur opzij. Detectie kan
hier echt, want io koppelt de stand terug: wijkt `windowcoverings_state` af
van wat de flow laatst stuurde, dan was het een mens. Uitzondering: de
windbeveiliging is nooit te overrulen.

## Randgevallen

- **TaHoma onbereikbaar** — niets doen, melden. Nooit blind commando's
  herhalen.
- **Wind valt weg** — niet automatisch weer sluiten binnen 30 minuten; windvlagen
  komen in golven.
- **Herstart** — de stand van RTS-schermen is onbekend. Wacht op het volgende
  natuurlijke moment (zonsopgang/-ondergang) in plaats van te gokken.
- **Cloud-rate-limit bij Somfy** — commando's kunnen tijdens piekuren falen.
  Eén retry, dan stoppen en melden.

## Testen

Bouw een `--dry-run`: bereken de zonstand voor een opgegeven tijdstip en toon
welke actie de automatisering zóú nemen. Zo test je een zomerse middag in
februari.

## Openstaande vragen

- [x] Gevel en oriëntatie: serre, ONO 67° ✓
- [x] io of RTS: io, met terugkoppeling ✓
- [x] Sluitstand: de My-positie (105) ✓ (aanname — checken of die stand bevalt)
- [ ] Is er een windsensor op het scherm (io-windsensor), of moet wind uit een
      weerdienst-app in Homey komen?
- [ ] Temperatuurdrempel: welke buitentemperatuur voelt als "te warm voor de
      serre"? Startwaarde 22 °C, bijstellen in de praktijk.
- [ ] Overweging: Aqara temperatuur/vochtsensor in de serre voor sturing op
      binnentemperatuur (middaghitte komt niet via deze gevel binnen).
