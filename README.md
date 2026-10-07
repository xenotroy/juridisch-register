# Juridisch register arbeidsomstandigheden

[Open de interactieve tijdlijn en het register](https://xenotroy.github.io/juridisch-register/)

De webversie werkt in een actuele browser op Windows 11, macOS en mobiel. Er is geen installatie nodig om de site te gebruiken.

## Inhoud

- Interactieve tijdlijn voor lesdag 1: negen hoofdmijlpalen en acht optionele kleinere stappen, vanaf de Mijnwet 1810.
- Klik op de laatste zichtbare kaart om één volgende stap te onthullen. Toon alles en opnieuw beginnen zijn beschikbaar.
- Minitijdlijnen, presentatiemodus, lesvragen en afzonderlijk te openen docentantwoorden.
- Vier incidentcasussen: DSM Beek, Seveso, Enschede en Chemie-Pack.
- Arbowet en Arbobesluit met beschikbare historische teksten, artikelvergelijking, onderwerplabels en ARIE-zoekroute.
- Opgeslagen officiële bronnen en bronmetadata, inclusief lokale checksums.

De dataset is onderzocht op 5 oktober 2026 en wordt niet automatisch bijgewerkt. De geconsolideerde artikelhistorie begint in 2002. Lesduiding en toelichtingsmappings zijn redactioneel of afgeleid; inhoudelijke classificatie en continuïteit zijn nog niet beoordeeld. Bij 24 Arbowet-toestanden is de manifesthash afwijkend; de lokale checksums en XML-identiteiten worden afzonderlijk gecontroleerd.

## Zelf bouwen, ook op Windows 11

Benodigd: Node.js 22 of hoger, npm en Python 3.13 of hoger. De bronverwerking gebruikt alleen de standaardbibliotheek van Python en de meegeleverde officiële bestanden.

```powershell
git clone https://github.com/xenotroy/juridisch-register.git
cd juridisch-register
py -3 pipeline/build.py
npm ci --prefix app
npm run build --prefix app
py -3 pipeline/serve.py --port 8846 --open
```

Op macOS/Linux gebruik je `python3` in plaats van `py -3`. Op Windows kun je na het bouwen ook `start-register.cmd` openen. Houd het terminalvenster open tijdens gebruik; Ctrl+C stopt de lokale server.

## GitHub Pages

Elke push naar `main` genereert het register opnieuw uit de gearchiveerde bronnen, voert vijftien datatests uit en publiceert de statische app via GitHub Actions. De build gebruikt `REGISTER_BASE_PATH=/juridisch-register/`. Zonder die variabele blijft de lokale build op `/` werken.

```sh
python3 pipeline/build.py
npm ci --prefix app
REGISTER_BASE_PATH=/juridisch-register/ npm run build --prefix app
python3 pipeline/prepare_site.py
```

`app/dist/` bevat dan de volledige webversie inclusief de originele bronbestanden onder `raw/`. `pipeline/prepare_site.py` maakt een afgeleide kopie voor de statische site; de bronbytes onder `data/raw/` blijven behouden.

## Structuur

- `app/src/`: React/TypeScript-interface.
- `pipeline/`: bronverwerking, checks en lokale server.
- `data/raw/`: onveranderde officiële publicaties en snapshots met provenance.
- `data/source-index/`: bronroutes en checksums.
- `data/editorial/`: geselecteerde lesmomenten en korte onderwerplabels.
- `.github/workflows/pages.yml`: gecontroleerde build en publicatie.

Officiële bronteksten komen uit het Basiswettenbestand/KOOP, Officiële Bekendmakingen en de per bron vastgelegde overheidswebsites. Bronfeit, lesduiding en afgeleide toelichtingskoppeling worden in de interface onderscheiden.
