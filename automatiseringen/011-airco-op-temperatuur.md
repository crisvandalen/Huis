# 011 — Airco automatisch aan op basis van temperatuur

**Status:** idee
**Draait op:** voorstel: Homey-flow via een IR-zender (route C), met de
temperatuur van de tado-thermostaat die al in Homey zit

## Wat moet het doen

Als het in de ruimte van de airco te warm wordt, zet het huis de Qventi-airco
zelf aan op koelen, en weer uit als het koel genoeg is.

## Waarom

De airco kan nu alleen met de hand (afstandsbediening of Smart Life-app). Bij
warm weer sta je dan al in een warme kamer voordat hij aangaat. Hij moet mee in
de automatisering zoals de rest van het huis.

## Situatie (08-11-2026)

- Qventi-airco met de **USB-Tuya wifi-module**, staat in de **Smart Life-app**.
- De route uit 004 (officiële Tuya-app `com.tuya2` op Homey) **lukte niet**:
  de airco is niet aan Homey te koppelen. *(Wat ging er precies mis? Zie
  openstaande vragen; misschien is dat nog op te lossen.)*
- De eigen Tuya-cloud-route (`scripts/tuya/airco.mjs`) is eerder vastgelopen
  op het aanmaken van het Tuya IoT Cloud-project.
- In Homey zit al een **tado-thermostaat** die de kamertemperatuur meet
  (`measure_temperature`) (Cris, 08-11). Die gebruiken we als sensor; er hoeft
  geen losse sensor bij, mits de tado in dezelfde ruimte hangt als de airco.
- De Smart Life-app toont **geen binnentemperatuur** van de airco (Cris,
  08-11). De wifi-module geeft die dus niet door; de kamertemperatuur komt van de
  tado.

## Route-keuze

| | Route | Wat kost het | Plus | Min |
|---|---|---|---|---|
| ~~A~~ | ~~Automatisering in de Smart Life-app~~ | — | — | **afgevallen** (08-11): de app toont geen binnentemperatuur, alleen het weer buiten |
| **B** | **Lokaal via `tinytuya` op linuxcris** (script praat over het LAN met de wifi-module) | eenmalig de `local_key` van de airco ophalen (vraagt alsnog één keer een Tuya IoT-project) | lokaal, met status, kan alles | hetzelfde Tuya-console-gedoe waar route 004/A op vastliep; de key verandert als je de airco opnieuw koppelt |
| **C** | **IR-zender in Homey** (bv. Broadlink RM4 mini, met Homey-app) die de knoppen van de afstandsbediening nadoet | ~€30 | helemaal lokaal, geen Tuya; gewoon een Homey-flow met Homey-sensoren, aanwezigheid en zonne-overschot | **geen statusterugkoppeling** (net als RTS); de zender moet zicht op de airco hebben |

**Voorstel: C.** A valt af (geen binnentemperatuur in Smart Life). B verliest
zijn grootste plus: de module meldt geen kamertemperatuur, dus ook bij B is een
losse sensor nodig, en het Tuya-console-gedoe blijft. C brengt de airco echt in
Homey, zonder afhankelijk te zijn van Tuya's cloud of console. Airco-afstandsbedieningen sturen bij elke druk de **hele stand** mee
(aan, koelen, temperatuur, ventilator), dus één aangeleerde code "koelen 22 °C
aan" zet de airco altijd in dezelfde stand, wat hij ook deed. Dat maakt het
gebrek aan terugkoppeling grotendeels onschuldig.

## Trigger (route C)

- Kamertemperatuur van de **tado-thermostaat** (Homey-device, `measure_temperature`) stijgt **boven 25 °C**
  → aan.
- Kamertemperatuur zakt **onder 23 °C** → uit.
- De 2 °C ertussen is de **hysterese**: zo gaat de airco niet elke paar minuten
  aan en uit. Getallen nog af te stemmen met Cris.

## Voorwaarden

- Alleen als er **iemand thuis** is (of: thuiskomst binnen een half uur, als
  dat signaal er ooit komt).
- Alleen **tussen 08:00 en 23:00**; 's nachts niet (geluid in de slaapkamer?
  vraag aan Cris).
- **Niet** als er de afgelopen 2 uur met de hand aan de airco is gezeten (zie
  Ontsnapping).
- Optioneel later: alleen bij zonne-overschot, of eerder voorkoelen als er
  veel zon wordt verwacht (koppeling met 005-energie-live).

## Actie

1. Temperatuur boven de drempel en voorwaarden kloppen → IR-code
   "koelen 22 °C aan" sturen.
2. Een Homey-variabele `airco_aan_door_automaat = ja` zetten (Homey weet de
   stand anders niet; dit is een **aanname**, geen meting).
3. Temperatuur onder de drempel én `airco_aan_door_automaat = ja` → IR-code
   "uit" sturen en de variabele op `nee`.
4. Hij zet alleen uit wat hij zelf heeft aangezet. Een airco die iemand met de
   hand heeft aangezet blijft aan.

## Ontsnapping

- Afstandsbediening en Smart Life-app blijven gewoon werken.
- Een Homey-knop/-schakelaar **"Airco automaat"** (aan/uit) zet de
  automatisering helemaal stil. Op het dashboard tonen.
- Met de hand bediend? Dat ziet Homey bij route C niet. Daarom: de automaat
  stuurt hoogstens **één keer per 2 uur** een aan-commando, zodat iemand die hem
  met de hand uitzet niet meteen wordt overruled.

## Randgevallen

- **Airco staat al aan** (met de hand): nog een keer "koelen 22 °C aan" sturen
  kan geen kwaad, alleen de stand wordt dan 22 °C. Wil je dat niet, dan is dat
  een reden voor route B.
- **Zender ziet de airco niet / airco zonder stroom:** het commando komt niet
  aan en Homey merkt dat niet. Als de temperatuur na 30 min nog steeds stijgt:
  pushbericht "airco reageert niet?".
- **Niemand thuis:** niets doen. Iemand thuisgekomen in een warm huis → de
  trigger slaat vanzelf aan bij de volgende meting.
- **tado verwarmt:** de airco mag niet gaan koelen terwijl de tado aan het
  verwarmen is (tegen elkaar in werken). Voorwaarde: tado-doeltemperatuur ligt
  onder de kamertemperatuur, of de tado staat uit / in zomerstand.
- **tado offline / batterij leeg / tado-cloud weg:** geen nieuwe meting = geen actie. Een airco
  die al aanstaat gaat dan ook niet uit, dus: als de sensor >1 uur niets meldt
  en de automaat heeft hem aangezet → uit en melden.
- **Stroomuitval en herstart:** de airco komt meestal uit terug; de Homey-
  variabele kan dan nog op `ja` staan. Bij herstart van Homey de variabele
  resetten naar `nee`.
- **Raam open:** valt buiten scope tot er raamsensoren zijn.

## Testen

- IR-codes los testen vanuit de Homey-app ("aan", "uit"): reageert de airco
  vanaf de plek van de zender?
- Drempel tijdelijk op 18 °C zetten → airco moet binnen één meting aangaan;
  weer terug → uit.
- Met de hand uitzetten terwijl het warm is → de automaat mag het binnen 2 uur
  niet opnieuw aanzetten.
- Eerst een week met alleen een **pushbericht** ("nu zou ik de airco aanzetten")
  in plaats van het IR-commando, om de drempels te ijken.

## Openstaande vragen

- [ ] **Wat ging er mis met `com.tuya2`?** Verscheen de airco niet in de lijst,
      of kwam hij wel binnen maar zonder bediening? Als hij er wel in staat maar
      zonder de juiste capabilities is dat misschien nog op te lossen, en dan
      wordt dit een gewone Homey-flow mét status (en is 004 ook weer bruikbaar).
- [x] ~~Route A~~ valt af: Smart Life heeft geen binnentemperatuur (08-11).
- [ ] Akkoord met route **C** (alleen een IR-zender kopen, ~€30)?
- [x] Sensor: de **tado-thermostaat** die al in Homey zit (08-11).
- [ ] Hangen de airco en de tado in **dezelfde ruimte**? Zo niet, dan meet de
      tado de verkeerde kamer en is toch een losse sensor (~€15) nodig.
- [ ] Na `make homey`: de tado opzoeken in de export (driver, capabilities) en in
      `apparaten.yaml` zetten.
- [ ] Drempels: aan boven 25 °C en uit onder 23 °C, op 22 °C koelen. Akkoord?
- [ ] Mag hij 's nachts aan (slaapkamer)? Alleen als er iemand thuis is?
