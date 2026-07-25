# 002 — Apple TV als aanwezigheids- en sfeersignaal

**Status:** idee
**Draait op:** nog te bepalen (zie ADR 0002)

## Wat moet het doen

Als er op de Apple TV iets afspeelt, past het huis zich aan: licht dimt,
zonwering sluit bij tegenlicht, en bij pauze komt het licht weer een beetje op.

## Waarom

Twee dingen tegelijk: het is prettig, en de Apple TV is nevenbij een
betrouwbaar signaal dat er echt iemand in de woonkamer is — beter dan
telefoon-aanwezigheid, die ook aanstaat als je slaapt.

## Trigger

`pyatv` push updates op de `companion`- en `airplay`-protocollen:

| Event | Betekenis |
| --- | --- |
| `playing` | film/serie gestart |
| `paused` | pauze |
| `idle` / `off` | klaar of uit |

Pollen is niet nodig: `atvremote push_updates` levert events zodra ze gebeuren.

## Voorwaarden

- Alleen tussen zonsondergang en 01:00 dimmen — overdag is dimmen zinloos.
- Niet dimmen als er in de woonkamer net handmatig licht is gezet (< 10 min).
- Muziek (AirPlay audio) is geen film: dan alleen de zonwering laten staan.

## Actie

**Bij `playing`:**
1. Woonkamerlicht naar de filmstand (*percentage invullen*).
2. Als de zon nog op het scherm staat: die gevel sluiten.

**Bij `paused`:** licht naar 40 % — genoeg om iets te pakken.

**Bij `idle`/`off`:** terug naar de normale avondstand.

## Ontsnapping

Elke handmatige lichtbediening zet deze automatisering 30 minuten opzij. De
Apple TV zelf blijft natuurlijk gewoon werken.

## Randgevallen

- **Apple TV valt van het netwerk** — geen actie, en zeker geen "dan is het
  dus uit"-conclusie. Alleen echte `off`-events tellen.
- **Iemand kijkt via een ander apparaat** — buiten scope; dit gaat puur over de
  Apple TV.
- **Credentials verlopen** — pairing opnieuw doen. Meld dit duidelijk in plaats
  van stil te falen.
- **Meerdere Apple TV's** — stuur op de identifier, nooit op de naam.

## Testen

Start iets, pauzeer, stop. Log wat de automatisering ziet en zou doen, vóórdat
je het licht daadwerkelijk laat schakelen.

## Openstaande vragen

- [ ] Welke lampen horen bij "woonkamerlicht"?
- [ ] Wat is de filmstand — helemaal uit, of een klein beetje aan?
- [ ] Moet muziek ook iets doen?
