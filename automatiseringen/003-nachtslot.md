# 003 — Nachtslot-check voordeur

**Status:** gebouwd (29-07, in één keer geverifieerd aangemaakt) — aanzetten
na controle in de app
**Draait op:** 1 Homey advanced flow (via `scripts/homey/maak-nachtslot-flow.mjs`)

## Wat moet het doen

Om 23:45 controleren of de voordeur (Nuki) op slot zit; zo niet, dan
automatisch afsluiten en een melding sturen dat dat gebeurd is.

## Waarom

De export liet zien dat de deur 's nachts weleens open blijkt te staan.
Handmatig controleren gebeurt juist niet op de avonden dat je moe bent — dus
precies wanneer het misgaat.

## Trigger

Tijd is 23:45.

## Voorwaarden

Nuki-status is **niet** "op slot". Zit hij al op slot, dan gebeurt er niets —
ook geen melding (geen ruis om niks).

## Actie

1. Nuki op slot draaien.
2. Pushmelding: "Voordeur stond om 23:45 nog open — automatisch op slot
   gedraaid."

## Ontsnapping

Gewoon weer opendoen — met de app, de knop op de Nuki of de sleutel. De flow
draait één keer per nacht en komt pas de volgende avond terug. Wie om 23:45
buiten staat heeft z'n telefoon (Nuki-app) of sleutel nodig; dat is de
afgesproken afweging.

## Randgevallen

- **Nuki onbereikbaar / batterij leeg** — het slot-commando faalt dan stil.
  Daarom staat de melding ná de slot-actie: geen melding ontvangen terwijl de
  deur open stond = zelf even kijken. (Batterij-alarm van de Nuki zelf staat
  los hiervan.)
- **Deur staat fysiek open (kier)** — de Nuki heeft een deursensor
  (`alarm_contact`); op slot draaien bij een openstaande deur kan de dagschoot
  laten uitsteken. Voor v1 accepteren we dit; blijkt het een probleem, dan
  voegen we de contact-conditie toe.
- **Gasten/oppas** — die moeten kunnen uitchecken via de Nuki-app, anders
  staan ze om 23:45 op slot.

## Testen

Zet de tijd-trigger tijdelijk op over-vijf-minuten, laat de deur van het slot,
en wacht. Daarna de trigger terugzetten op 23:45.
