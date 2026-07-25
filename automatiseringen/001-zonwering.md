# 001 — Zonwering op zon, wind en aanwezigheid

**Status:** idee
**Draait op:** nog te bepalen (zie ADR 0002)

## Wat moet het doen

Schermen sluiten wanneer de zon een gevel echt raakt en het binnen te warm
dreigt te worden, en ze weer openen zodra dat niet meer speelt — met wind
altijd als noodrem.

## Waarom

Handmatig bedienen gebeurt te laat: tegen de tijd dat het opvalt is het al
warm. Andersom blijven schermen dicht op momenten dat je juist licht en uitzicht
wil.

## Trigger

- Zonstand passeert de drempel voor een gevel (azimut + elevatie), én
- buitentemperatuur boven de drempel, én
- geen bewolking boven de drempel.

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

1. Bepaal per gevel of de zon erop staat (azimut binnen bereik, elevatie > 10°).
2. Sluit de schermen van die gevel naar de ingestelde stand.
3. Zodra de zon de gevel verlaat of het bewolkt wordt: open weer, mits het
   nog licht is.
4. Bij zonsondergang: alles open (of dicht, als je ook privacy wil — dat is
   dan wél een aparte automatisering).

## Ontsnapping

Handbediening wint altijd, en zet de automatisering voor die zonwering 2 uur
opzij. Uitzondering: de windbeveiliging is nooit te overrulen.

Bij io-homecontrol is handbediening te detecteren via de status. **Bij RTS
niet** — daar weet het systeem alleen wat het zelf gestuurd heeft. Voor
RTS-schermen betekent dat: minder vaak sturen, en liever een vaste dagritme dan
fijnmazig reageren.

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

- [ ] Welke gevels en oriëntaties? (`inventaris/apparaten.yaml`)
- [ ] io of RTS per scherm?
- [ ] Is er een windsensor, of komt wind uit een weerdienst?
- [ ] Wat is de gewenste sluitstand — helemaal dicht, of op kier voor licht?
