# LKPR Radio Trainer

Výukový trenažér radiové komunikace pro odlet z letiště Praha/Ruzyně (LKPR / Václav Havel Airport). Uvidíte letiště podle dat OpenStreetMap, uslyšíte instrukce ATC v anglické frazeologii a odpovídáte mikrofonem nebo klávesnicí. Letadlo se pohne jen po správném readbacku. Na dráhu nesmí vjet po pouhém povolení k pojíždění a nesmí se rozjet ke vzletu po instrukci „line up and wait“.

Program je cvičný. Není to provozní pomůcka a nenahrazuje AIP, mapu ani výcvik s instruktorem.

Rozhraní aplikace je anglicky. Tento návod je česky.

## Co je ověřené a co je jen cvičení

Ověřené z českého AIP (eAIP LKPR, staženo 2026-11-03 z [aim.rlp.cz](https://aim.rlp.cz/eaip/html/eAIP/LK-AD-2.LKPR-en-GB.html)):

- Dráhy 06/24 (3715 × 45 m) a 12/30 (3250 × 45 m).
- Pořadí preferovaných drah začíná dráhou 24 (AD 2.21).
- Volací značky a kmitočty: Ruzyně Delivery 120.060, Ruzyně Ground 121.910, Ruzyně Tower 134.560, Praha Radar pro odlety 120.530, ATIS 122.160.
- Jména pojezdových drah A1 a Z, které scénář používá, jsou v AIP. Držení dráhy 24 na TWY Z AIP zmiňuje.

Simulované, v aplikaci i zde označené jako training:

- QNH 1013 hPa je standardní tlak pro cvičení, ne živé ATIS ani METAR.
- Není tu SID, trať, squawk ani počáteční hladina. Ty závisejí na konkrétním letu a nejsou vymyšlené.
- Volací znak OK-ABC je fiktivní.
- Pokyn „taxi via Alfa one and Zulu“ vede po jedné cestě v grafu pojezdových drah OSM. Není to zveřejněná standardní trať.
- Mezi A1 a Z je v OSM asi 67 m pojezdové dráhy bez jména. Aplikace jí nevymýšlí označení.
- Rychlost symbolu na mapě je zrychlená, aby cvičení netrvalo jako skutečné pojíždění.

Podrobnosti jsou v aplikaci pod tlačítkem Sources a v souboru `data/sources.json`. Před skutečným letem si ověřte aktuální AIP. Data se mění.

Mapa: © OpenStreetMap contributors, licence ODbL. Není to oficiální letištní mapa AD 2-LKPR-2-1.

## Instalace ve Windows (PowerShell, Python 3.13)

Otevřete PowerShell ve složce projektu. Když Windows hlásí, že spouštění skriptů je zakázané, příkaz `Set-ExecutionPolicy` níže platí jen pro toto okno a nemění nastavení systému.

```powershell
cd C:\cesta\k\tomuto\projektu
py -3.13 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8741
```

Když příkaz `py -3.13` není k dispozici, vytvořte prostředí takto:

```powershell
python -m venv .venv
```

Pak aktivaci a instalaci spusťte stejně jako výše.

Trvalé povolení lokálních skriptů pro váš účet, pokud ho chcete (není nutné pro jednorázové spuštění):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Stejný start umí i skript `Start-LKPR-Trainer.ps1`:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Start-LKPR-Trainer.ps1
```

V prohlížeči otevřete [http://127.0.0.1:8741](http://127.0.0.1:8741).

Server nechte běžet. Zastavíte ho klávesami Ctrl+C v okně PowerShellu.

## Mikrofon

1. Na počítači použijte Chrome nebo Edge. Rozpoznávání řeči je Web Speech API a na `http://127.0.0.1` funguje. Firefox spolehlivý hlas nemá; pište do pole Typed transmission.
2. iPhone a iPad jsou v části Mobil. Web Speech API v Safari je nespolehlivé a posílá zvuk na servery Apple. Aplikace proto umí nahrávku poslat na váš Python a přepsat ji volitelným faster-whisper.
3. U adresního řádku povolte mikrofon pro tuto stránku.
4. Ve Windows otevřete Nastavení, Soukromí a zabezpečení, Mikrofon. Povolte přístup k mikrofonu a přístup pro prohlížeč.
5. Podržte tlačítko Push to talk, nebo podržte mezerník, mluvte anglicky a pusťte. Věta se odešle po puštění.
6. Když prohlížeč mikrofon nedostane, napište odpověď do pole a stiskněte Send. To je poslední záloha vždy.

Hodnocení nehledá doslovnou větu. Pozná volací znak i ve zkrácené podobě (Oscar Bravo Charlie, OK-ABC), dráhu jako „two four“, „24“ i „twenty four“, a „alpha“ i „alfa“. Když chybí bezpečnostní prvek, ATC řekne „Negative…“ a letadlo stojí, dokud readback neopravíte. Panel ukáže, co jste řekli, co se čekalo a co chybělo.

## Hlas ATC a rádio

Hlas je zdarma a lokálně:

- Prohlížeč (`speechSynthesis`), vždy k dispozici bez registrace.
- Když je na počítači pyttsx3, Windows použije systémový hlas SAPI a stránka ho přehraje přes Web Audio: pásmová propust, lehký šum a klapnutí squelche na začátku a na konci. Na Linuxu poslouží espeak-ng.

Kmitočty na štítku stanice jsou z AIP. QNH ve větě Delivery je cvičné.

## Cvičení Departure

1. Zavoláte Ruzyně Delivery a požádáte o spouštění.
2. Přečtete dráhu 24, QNH a kmitočet Ground.
3. Zavoláte Ruzyně Ground a požádáte o spouštění a pushback.
4. Přečtete obojí. Teprve potom letadlo couvá ze stojánky 3.
5. Přečtete pojíždění přes Alfa 1 a Zulu a „hold short“ dráhy 24. Špatná dráha letadlo nepustí.
6. U vyčkávacího místa přečtete hold short a kmitočet Tower.
7. Přečtete „line up and wait“. „Cleared for takeoff“ v tomto kroku je chyba a na dráhu vás nepustí.
8. Až jste srovnaní na dráze, přijde samostatné povolení ke vzletu. Bez něj se rozjezd nespustí.
9. Přečtete přechod na Praha Radar 120.530 a uvidíte skóre.

Arrival a Random practice jsou v navigaci připravené jako další scénáře a v této verzi se nehrají.

Skóre je cvičný návrh (40 % kritické instrukce, 15 % volací znak, 25 % dráha a trať, 20 % úplnost), ne úřední zkouška.

## Testy

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest
```

## Když to nejde

- `py` nebo `python` nic nedělá: nainstalujte Python 3.13 z python.org a při instalaci zaškrtněte Add python.exe to PATH. Pak nové okno PowerShellu.
- Červený text o ExecutionPolicy: použijte `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` a aktivaci `.venv` spusťte znovu.
- Prohlížeč píše, že se na stránku nelze dostat: v okně s uvicornem musí běžet server. Na počítači je adresa `http://127.0.0.1:8741`. Pro telefon ve Wi-Fi je `https://` adresa z části Mobil.
- Port 8741 je obsazený: zastavte druhou kopii, nebo spusťte `python -m uvicorn app.main:app --host 127.0.0.1 --port 8742` a tu adresu otevřete.
- Mikrofon mlčí: zámek v adresním řádku, systémové oprávnění Windows, a prohlížeč Chrome nebo Edge. Mezitím pište odpovědi.
- ATC je potichu: tlačítko Skip voice řeč přeskočí, psaní funguje i během řeči. Na Windows pyttsx3 potřebuje hlas v Nastavení, Čas a jazyk, Řeč. Bez něj mluví hlas prohlížeče a rádio přidá šum a squelch.
- Mapa je prázdná: obnovte stránku. Data jsou v `data/lkpr_aeroway.geojson` a nemají se stahovat při každém startu.
- Testy: `python -m pytest` ve složce projektu s aktivním `.venv`.

## Mobil a PWA (iPhone, iPad, Safari)

Rozložení je stejná aplikace. Na výšku je nahoře mapa a dole rádio, tlačítko Push to talk je velké a drží se u palce. Na šířku je mapa vedle rádia. iPad drží mapu vedle panelu jako počítač, s větším tlačítkem.

Přidání na plochu:

1. V Safari otevřete adresu trenéra.
2. Sdílet, Přidat na plochu.
3. Ikona LKPR Radio otevře aplikaci bez lišty Safari. Manifest, barva a apple-touch-icon jsou v projektu.

První klepnutí odemkne zvuk (iOS jinak řeč ani rádio nepustí). Hlas ATC, který jde jako WAV ze serveru, pak hraje přes Web Audio s filtrem. Záložní hlas prohlížeče (`speechSynthesis`) iOS často přehraje jen přímo při klepnutí, ne až po odpovědi serveru. Na iPhonu proto počítejte s hlasem ze serveru (pyttsx3 / espeak v Dockeru).

Volba Voice input:

- Auto: Chrome a Edge mluví přes Web Speech API. iPhone nahrává a přepisuje server, když je nainstalovaný faster-whisper. Jinak zbývá psaní.
- Browser speech: Web Speech API. Na iPhonu nespolehlivé.
- Record and transcribe: MediaRecorder. iOS pošle mp4/aac, Chrome webm. Server přepíše faster-whisper (model base, CPU).
- Typing only: jen klávesnice.

### HTTPS, protože iOS mikrofon jinak nepustí

`http://127.0.0.1` je zabezpečené jen na tom samém zařízení. `http://192.168…` z iPhonu mikrofon nedostane.

Ve stejné Wi-Fi, z PowerShellu ve složce projektu (potřebujete openssl, je v Git for Windows):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Start-LKPR-HTTPS.ps1
```

Skript vypíše adresu `https://<ip-počítače>:8741`. Povolte port 8741 ve firewallu Windows pro soukromou síť.

iPhone vlastnímu certifikátu nevěří sám od sebe. Safari ukáže varování. Důvěra se zapíná v Nastavení, Obecné, Informace, Nastavení důvěryhodnosti certifikátů, až když je certifikát v profilu zařízení. Je to nepohodlné a po změně IP se certifikát dělá znovu. Na cestě mimo domov je jednodušší nasazení níže, které má HTTPS od poskytovatele.

Volitelný přepis na vlastním počítači:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-whisper.txt
```

Potřebuje také ffmpeg v PATH (na Windows třeba `winget install Gyan.FFmpeg`). Model `base` bere zhruba 1 GB RAM, model `small` zhruba 2 GB. Bez tohoto balíčku přepis vrací chybu a psaní dál funguje. Proměnná `WHISPER_MODEL` může být `tiny`, `base` nebo `small`.

### Výuka a hlas na iPhonu

Při první návštěvě se spustí krátký průvodce v angličtině. Tlačítko Start je zároveň odemčení zvuku: iOS pustí ATC až po klepnutí. Průvodce lze znovu otevřít tlačítkem Tutorial. Next, Back a Skip jsou dole na obrazovce, ať panel na iPhonu nepřeteče.

Každá hláška ATC se čte nahlas a zároveň je v textu. Tlačítko Repeat ji zopakuje, Speaker on/off ji ztlumí. Když server nestihne hlas do osmi sekund, mluví hlas prohlížeče. Na iPhonu postranní přepínač tichého režimu zvuk ztiší: hlasitost nahoru a tichý režim vypnout.

Auto na iPhonu nejdřív zkusí rozpoznání Safari. Slova se objeví v poli, zkontrolujete je a klepnete na Send. Když Safari nepustí mikrofon a na serveru je faster-whisper, další stisk nahrává. Na Renderu bez whisperu zbývá psaní. Na počítači se věta po puštění tlačítka odešle sama, jako dřív.

### Co jede offline a co potřebuje server nebo internet

Po jednom úspěšném otevření si stránka do service workeru uloží vzhled, skripty a data mapy (`/api/airport`). Bez sítě se diagram může ukázat znovu.

Bez vašeho serveru nefunguje:

- nový krok scénáře, skóre a pohyb podle readbacku (logika je v Pythonu),
- přepis nahrávky faster-whisper,
- WAV hlas ATC (pyttsx3 / espeak). Záloha je hlas prohlížeče, na iPhonu nespolehlivá.

Internet navíc:

- Web Speech API v Safari posílá zvuk na servery Apple,
- Web Speech API v Chrome může použít Google,
- první stažení modelu faster-whisper,
- nasazená verze mimo váš počítač.

Psaní odpovědi, mapa z mezipaměti a šipka letadla (když scénář běží) nepotřebují placenou službu. Scénář samotný ale potřebuje běžící Python.

## Nasazení mimo domácí Wi-Fi

Účty ani nasazení za vás nedělám. Soubory `Dockerfile` a `fly.toml` jsou připravené. Obraz poslouchá na portu z proměnné `PORT` (výchozí 7860) a má espeak-ng a ffmpeg. faster-whisper v obraze není, dokud v Dockerfile nezměníte `ARG INSTALL_WHISPER=0` na `1`.

Doporučení: Hugging Face Spaces, SDK Docker, hardware CPU basic (zdarma, řádově 16 GB RAM, hotové HTTPS). Na 512 MB RAM (bezplatný Render, malý Fly) faster-whisper nespouštějte. iPhone by tam měl jen psaní a nespolehlivé Web Speech API.

### Hugging Face Spaces

1. Účet na huggingface.co, New Space, SDK Docker, hardware CPU basic, veřejný nebo soukromý Space.
2. Do Space nahrajte složky `app`, `static`, `data` a soubory `Dockerfile`, `requirements.txt`, `requirements-whisper.txt`.
3. Když chcete přepis z iPhonu, v Dockerfile nastavte `ARG INSTALL_WHISPER=1` a nechte hardware CPU basic. Build stáhne PyTorch a model se dotáhne při prvním nahrání (stovky MB, první věta trvá déle).
4. Space dostane adresu `https://<jméno>.hf.space`. Tu otevřete v Safari a přidejte na plochu.
5. Space po nečinnosti usne. První otevření ho vzbudí.

### Render

1. New Web Service, prostředí Docker, kořen s tímto Dockerfile.
2. Render sám nastaví `PORT` a HTTPS.
3. Nechte `INSTALL_WHISPER=0`. Bezplatná instance má 512 MB a model se do ní nevejde. Hlas ATC pojede přes espeak v obraze. Na iPhonu pište, nebo zkuste Browser speech s vědomím, že Safari je nespolehlivé.
4. Health check: `/api/health`.

### Fly.io

1. Nainstalujte `flyctl`, ve složce projektu `fly launch` (soubor `fly.toml` už vnitřní port 7860 a HTTPS má).
2. `fly deploy`.
3. Přepis: v `fly.toml` změňte `INSTALL_WHISPER` na `"1"` a `memory` na `"2048mb"`, pak znovu deploy. Dva gigabajty už nejsou v malém bezplatném limitu. Region `fra` je blízko.

Když stroj spí, první požadavek ho startuje. Cena a limity si ověřte na stránce poskytovatele, mění se.

## Složky

- `app/` — FastAPI, scénář odletu, hodnocení readbacku, lokální TTS, volitelný přepis
- `static/` — mapa, rádio, manifest a service worker
- `data/` — GeoJSON letiště, trať ze stojánky 3 a zdroje
- `scripts/build_lkpr_data.py` — znovu sestaví mapu z OSM výpisu
- `scripts/make_dev_cert.py` — cvičný HTTPS certifikát pro telefon ve Wi-Fi
- `Dockerfile`, `fly.toml` — příprava nasazení, nespouští se samy
- `tests/` — hodnocení, celý odlet přes psaný vstup, manifest a service worker
