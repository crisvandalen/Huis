# 011 — Airco automatisch koelen én verwarmen op temperatuur

**Status:** gespecificeerd (concept, drempels en tado-samenspel nog af te stemmen)
**Draait op:** Homey-flow. Temperatuur van de **tado-thermostaat** (al in
Homey); bediening via **infrarood**, bij voorkeur Homey's eigen IR, anders een
Broadlink-zender

## Wat moet het doen

Houd de kamer van de airco tussen twee grenzen: te koud → airco op verwarmen,
te warm → airco op koelen, daartussen uit.

## Waarom

De airco kan nu alleen met de hand (afstandsbediening of Smart Life-app). Je
zit dan al in een te warme of te koude kamer voordat hij aangaat. Hij moet mee
in de automatisering, en hij is een warmtepomp: verwarmen met de airco kan
goedkoper zijn dan met de cv (zeker bij zonne-overschot).

## Situatie (08-11-2026)

- Qventi-airco met de **USB-Tuya wifi-module**, staat in de **Smart Life-app**.
- De route uit 004 (officiële Tuya-app `com.tuya2` op Homey) **lukte niet**:
  de airco is niet aan Homey te koppelen.
- De eigen Tuya-cloud-route (`scripts/tuya/airco.mjs`) is eerder vastgelopen
  op het aanmaken van het Tuya IoT Cloud-project.
- De Smart Life-app toont **geen binnentemperatuur** van de airco. De
  wifi-module geeft die niet door.
- In Homey zit al een **tado-thermostaat** in **dezelfde kamer** als de airco
  (Cris, 08-11). Die levert de kamertemperatuur (`measure_temperature`) en
  regelt de cv in die kamer.
- Homey heeft zelf **infrarood** (Cris, 08-11).

## Route-keuze

| | Route | Plus | Min |
|---|---|---|---|
| ~~A~~ | ~~Automatisering in de Smart Life-app~~ | — | **afgevallen**: geen binnentemperatuur in de app |
| B | Lokaal via `tinytuya` op linuxcris | lokaal, met status | vraagt alsnog een Tuya IoT-project voor de `local_key`; de kamertemperatuur moet toch van de tado komen |
| **C1** | **Homey's eigen IR-zender** | gratis, al aanwezig | Homey Pro (2023) kan IR **zenden maar niet aanleren** (geen IR-ontvanger). Werkt alleen als de airco in Homey's IR-database staat (Qventi zelf, of het merk dat erachter zit), of als we de codes ergens anders vandaan halen |
| **C2** | **Broadlink RM4 mini** (~€30) met de Broadlink-app in Homey | leert de codes gewoon van je afstandsbediening | extra kastje |

**Keuze: C2.** C1 is afgevallen (geen airco in Homey's IR-lijst, ook niet onder TCL).
Wifi via `com.tuya2` blijft de voorkeur als die alsnog lukt (dan mét status). Bij beide: het
IR-signaal moet de airco kunnen "zien" (Homey of de Broadlink in zicht van de
airco).

Belangrijk voor beide: een airco-afstandsbediening stuurt bij elke druk de
**hele stand** mee (aan, modus, temperatuur, ventilator). Eén code "verwarmen
21 °C aan" zet de airco dus altijd in precies die stand, wat hij daarvoor ook
deed. Daardoor is het gebrek aan statusterugkoppeling (net als bij RTS) hier
grotendeels onschuldig. We hebben drie codes nodig:

| Code | Stand |
|---|---|
| `koelen` | aan, koelen, 22 °C, ventilator auto |
| `verwarmen` | aan, verwarmen, 21 °C, ventilator auto |
| `uit` | uit |

## Trigger

Elke nieuwe meting van `measure_temperature` van de tado (T):

| Situatie | Actie |
|---|---|
| T **< 19 °C** | `verwarmen` |
| T **≥ 21 °C** en airco staat (volgens ons) op verwarmen | `uit` |
| T **> 25 °C** | `koelen` |
| T **≤ 23 °C** en airco staat (volgens ons) op koelen | `uit` |
| daartussen | niets |

Tussen aan- en uit-grens zit steeds 2 °C (**hysterese**), zodat hij niet elke
paar minuten schakelt. Tussen 21 en 23 °C doet hij niets: de comfortzone.
Getallen zijn een voorstel.

## Samenspel met de tado

Zonder afspraak gaan de tado (cv) en de airco tegen elkaar in werken, of
verwarmen ze allebei. Voorstel:

- **Koelen** alleen als de tado **niet** aan het verwarmen is (tado uit,
  zomerstand, of doeltemperatuur onder T).
- **Verwarmen** met de airco: twee smaken, keuze aan Cris (zie vragen):
  1. **Airco als bijverwarming**: de tado blijft leidend; de airco springt
     alleen bij als het ver onder de 19 °C zakt (snel opwarmen).
  2. **Airco als hoofdverwarming**: de tado-doeltemperatuur in die kamer gaat
     omlaag (bv. 17 °C, als vangnet), de airco doet het werk. Vooral gunstig bij
     zonne-overschot (koppeling met 005-energie-live).

## Voorwaarden

- Alleen als er **iemand thuis** is.
- Alleen **tussen 07:00 en 23:00**, tenzij Cris anders beslist.
- Schakelaar **"Airco automaat"** staat aan.
- Hoogstens **één aan-commando per 2 uur** van dezelfde soort (zie
  Ontsnapping).

## Actie

1. Trigger en voorwaarden kloppen → IR-code sturen (`koelen`, `verwarmen` of
   `uit`).
2. Homey-variabele `airco_stand` zetten op `koelen` / `verwarmen` / `uit`.
   Dit is een **aanname**, geen meting: Homey kan niet zien wat de airco doet.
3. Uitzetten doet hij alleen als `airco_stand` zegt dat **de automaat** hem
   heeft aangezet. Een airco die iemand met de hand heeft aangezet blijft aan.

## Ontsnapping

- Afstandsbediening en Smart Life-app blijven gewoon werken.
- Schakelaar **"Airco automaat"** in Homey (en op het dashboard) zet de hele
  automatisering stil.
- Met de hand bediend? Dat ziet Homey niet. Daarom stuurt de automaat hoogstens
  één aan-commando per 2 uur, zodat iemand die hem met de hand uitzet niet
  meteen wordt overruled.

## Randgevallen

- **Airco staat al aan** (met de hand): opnieuw `koelen` sturen zet hem op
  22 °C. Dat is acceptabel.
- **Commando komt niet aan** (geen zicht, airco zonder stroom): Homey merkt het
  niet. Als T 30 min na een commando nog de verkeerde kant op gaat →
  pushbericht "airco reageert niet?".
- **Niemand thuis:** niets doen. Bij thuiskomst slaat de trigger vanzelf aan bij
  de volgende meting.
- **tado offline / tado-cloud weg:** geen meting = geen actie. Heeft de
  automaat de airco aangezet en komt er >1 uur geen meting → `uit` en melden.
- **Stroomuitval / Homey herstart:** `airco_stand` op `uit` zetten; de airco
  komt na stroomuitval doorgaans ook uit terug.
- **Overgang koelen ↔ verwarmen** op één dag (voor- en najaar): kan niet direct,
  want tussen 19 en 25 °C zit de uit-zone; een tussenstap via `uit` is
  automatisch.
- **Raam open:** valt buiten scope tot er raamsensoren zijn.

## Testen

- IR-codes los testen vanuit de Homey-app: reageert de airco vanaf de plek van
  de zender, op alle drie de codes?
- Drempels tijdelijk verschuiven (verwarmen-grens op 25 °C) → airco moet bij de
  volgende tado-meting op verwarmen; terugzetten → uit.
- Met de hand uitzetten terwijl het warm is → de automaat zet hem binnen 2 uur
  niet opnieuw aan.
- Eerst een week met alleen een **pushbericht** ("nu zou ik de airco op
  verwarmen zetten") in plaats van het IR-commando, om de drempels te ijken.

## Openstaande vragen

- [x] ~~Route A~~ valt af: Smart Life heeft geen binnentemperatuur (08-11).
- [x] Sensor: de **tado-thermostaat**, zelfde kamer als de airco (08-11).
- [x] Koelen **én** verwarmen (08-11).
- [ ] **Welke Homey heb je?** Homey Pro (2023) zendt IR maar leert niet aan;
      de oudere Homey Pro (2016–2019) kon wel aanleren.
- [x] "Qventi" staat **niet** in Homey's IR-lijst (Cris, 08-11).
- [x] TCL geprobeerd (08-11): Homey's IR-lijst heeft bij TCL **alleen tv's en
      soundbars**, geen airco's. Route **C1 valt af** → C2 (Broadlink) of een
      wifi-route. De Qventi is vermoedelijk een TCL (handleiding "R32 (T-PRO)",
      TCL-knoppen I FEEL / GENTLE WIND); handig om te weten bij het aanleren.
- [ ] Na `make homey`: tado opzoeken in de export (driver, capabilities, of hij
      ook `target_temperature` / verwarmstatus laat zien) en in
      `apparaten.yaml` zetten.
- [ ] Verwarmen: airco als **bijverwarming** (tado leidend) of als
      **hoofdverwarming** (tado als vangnet)?
- [ ] Drempels: verwarmen onder 19 → uit op 21; koelen boven 25 → uit op 23;
      standen 21 °C en 22 °C. Akkoord?
- [ ] Tijden: 07:00–23:00, alleen als er iemand thuis is. Akkoord?
