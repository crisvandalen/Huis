# 001 — Zonwering serre op zon en temperatuur

**Status:** gebouwd (29-07, via `scripts/homey/maak-zonwering-flows.mjs`) — nog
uitgeschakeld; aanzetten na controle in de app
**Draait op:** 3 Homey advanced flows + 2 logic-variabelen (ADR 0002)

De flows heten "Zonwering – Serre dicht (ochtend)", "– Serre open (middag)" en
"– handbediening wint". `ZW_FlowStuurt` staat 5 min aan rond eigen commando's
zodat de handbedieningsflow niet op zichzelf triggert; `ZW_Handbediend`
blokkeert beide stuurflows 2 uur na een handmatige ingreep.

## Situatie

Eén scherm: horizontale **binnenzonwering** in de serre (onder het glas),
io-homecontrol met terugkoppeling. Gevel **ONO (67°)**, locatie Waardenburg
(51.835 N / 5.251 O). De zon staat op deze kant van zonsopgang tot ca.
**13:30**; daarna geeft het huis schaduw. Zonstand-triggers komen uit de app
**Zonnestanden** die al in Homey draait.

Omdat het scherm binnen hangt is er **geen windrisico** — geen windsensor en
geen noodrem nodig. Dat maakt deze automatisering aanzienlijk eenvoudiger.

## Wat moet het doen

Het serre-scherm sluiten tijdens zonnige, warme ochtenden en weer openen
zodra de zon rond 13:30 van de serre af draait.

## Waarom

Handmatig bedienen gebeurt te laat: tegen de tijd dat het opvalt is het al
warm. Andersom blijven schermen dicht op momenten dat je juist licht en uitzicht
wil.

## Trigger

**Sluiten (ochtend):** zon-elevatie boven ~10° (Zonnestanden), én
buitentemperatuur boven de drempel, én geen zware bewolking.

**Openen (middag):** zonazimut passeert ~157° (zon draait van de gevel af,
rond 13:30) — of eerder, zodra het bewolkt raakt.

## Voorwaarden

| Voorwaarde | Waarde | Waarom |
| --- | --- | --- |
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
van wat de flow laatst stuurde, dan was het een mens.

## Randgevallen

- **Scherm onbereikbaar** (TaHoma-app of io-verbinding hapert) — niets doen,
  melden. Nooit blind commando's herhalen.
- **Herstart van Homey** — io geeft de echte stand terug, dus gewoon de status
  opvragen en verder; niets blind sturen.
- **Bewolkt-zonnig-bewolkt geflipper** — hysterese inbouwen: pas reageren als
  de bewolkingstoestand minstens 20 minuten stabiel is, anders klappert het
  scherm de hele dag.

## Testen

Bouw een `--dry-run`: bereken de zonstand voor een opgegeven tijdstip en toon
welke actie de automatisering zóú nemen. Zo test je een zomerse middag in
februari.

## Openstaande vragen

- [x] Gevel en oriëntatie: serre, ONO 67° ✓
- [x] io of RTS: io, met terugkoppeling ✓
- [x] Sluitstand: de My-positie (105) ✓ (aanname — checken of die stand bevalt)
- [x] Windsensor: niet nodig — scherm hangt bínnen de serre ✓
- [ ] Temperatuurdrempel: welke buitentemperatuur voelt als "te warm voor de
      serre"? Startwaarde 22 °C, bijstellen in de praktijk.
- [ ] Overweging: Aqara temperatuur/vochtsensor in de serre — bij een
      binnenscherm is de serretemperatuur zelf de eerlijkste stuurwaarde.
