# 010 — Mail & agenda lokaal ophalen (Vandaag-pagina)

**Status:** gebouwd
**Draait op:** script (`scripts/google/export_mail_agenda.py`) op linuxcris

## Wat moet het doen

Ongelezen mail (Gmail) en de komende afspraken (Google Agenda) rechtstreeks
vanaf linuxcris ophalen en naar `inventaris/export/mail-agenda.json` schrijven,
zodat de Ververs-knop en de uur-cron de Vandaag-pagina écht vers maken.

## Waarom

De Vandaag-pagina (`dashboard/vandaag.html`) toont mail + agenda uit
`mail-agenda.json`. Dat bestand werd tot nu toe alleen 's ochtends door Cowork
gevuld; de Ververs-knop (die op linuxcris draait, zonder Google-toegang) kon het
niet verversen — de "opgehaald"-tijd bleef daardoor op de ochtend hangen. Door
het ophalen lokaal te doen, ververst een tik op de knop het meteen.

## Trigger

- Ververs-knop op de Start- of Vandaag-pagina → `serveer.py /ververs`.
- Uur-cron op linuxcris (`git pull` + build).
- Handmatig: `make mail-agenda`.

## Voorwaarden

- Draait alleen als `scripts/google/token.json` bestaat (dus op linuxcris, niet
  op een Mac zonder credentials). `serveer.py` slaat de stap anders over.
- Alleen-lezen scopes (`gmail.readonly`, `calendar.readonly`): het script
  wijzigt nooit iets in mailbox of agenda.

## Actie

1. `serveer.py` voegt de stap **mail-agenda** toe (na de Homey-export, vóór de
   dashboard-build; niet-fataal).
2. Het script haalt op:
   - Gmail: `is:unread in:inbox` (max 15), met afzender, onderwerp, tijd en of
     het IMPORTANT-label aanwezig is; plus het exacte ongelezen-aantal uit het
     INBOX-label.
   - Agenda: vandaag t/m +7 dagen uit de agenda's `Cris` (crisvandalen@gmail.com)
     en `Gezin`, met start/eind/titel/locatie/hele_dag.
3. Schrijft `inventaris/export/mail-agenda.json` (schema onveranderd:
   `bron/opgehaald_op/agenda[]/mail{}`; `opgehaald_op` = nu).
4. `bouw_dashboard.py` pakt de nieuwste `mail-agenda.json` (export/ wint van
   data/) en schrijft `dashboard/mail-agenda.json` dat de pagina fetcht.

## Ontsnapping

Geen apparaatsturing; puur uitlezen. Uitzetten = de token weghalen of de stap uit
`serveer.py` halen. De data valt dan terug op de laatst geschreven versie.

## Randgevallen

- **Geen token / verlopen zonder refresh:** stap faalt niet-fataal; de build gaat
  door met de vorige `mail-agenda.json`. Opnieuw autoriseren met `make google-auth`.
- **Google plat / rate limit:** één stukke agenda wordt overgeslagen (waarschuwing
  in de log), de rest gaat door; bij een harde fout wordt niets weggeschreven
  (oude data blijft staan).
- **Mac zonder credentials:** `token.json` ontbreekt → `serveer.py` slaat de stap
  over, `make serve` blijft werken.
- **Herstart/stroomuitval:** stateless; komt na reboot vanzelf mee met de cron.

## Eenmalige setup (Google OAuth)

1. Google Cloud Console → nieuw project → **Gmail API** en **Google Calendar API**
   inschakelen.
2. OAuth-toestemmingsscherm: **Extern**, testgebruiker = crisvandalen@gmail.com
   (blijft in testmodus prima).
3. Inloggegevens → OAuth-client-ID → type **Desktop app** → `credentials.json`
   downloaden en neerleggen als `scripts/google/credentials.json`.
4. Op de Mac (heeft een browser): `make google-auth` → toestemming geven → dit
   schrijft `scripts/google/token.json`.
5. `credentials.json` + `token.json` naar linuxcris kopiëren
   (`~/huis/scripts/google/`), en daar dependencies installeren (`make setup` of
   `pip install -r scripts/requirements.txt` in de venv).
6. Uur-cron op linuxcris uitbreiden: `make homey mail-agenda dashboard`.

`credentials.json` en `token.json` staan in `.gitignore` (geheimen, niet in git).

## Testen

- `make mail-agenda` → print "`N afspraken, M ongelezen -> …/mail-agenda.json`" en
  het bestand bevat een verse `opgehaald_op`.
- Op de iPhone: tik ↻ Ververs op de Vandaag-pagina → de "opgehaald"-tijd springt
  naar nu en nieuwe mail/afspraken verschijnen.
