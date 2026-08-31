# zjedzmy_getcontacts

Wyciąganie bazy klientów z panelu Zjedz.my (`/profile#company-users`) do CSV
nadającego się do kampanii mailowych i SMS.

> **Masz to tylko uruchomić, a nie grzebać w środku?**
> [INSTRUKCJA.md](INSTRUKCJA.md) — krok po kroku, bez zakładania,
> że siedzisz w terminalu na co dzień.

## Co wyciągamy

| kolumna | opis |
|---|---|
| `nick` | nazwa użytkownika |
| `email` | **główny** adres do kampanii (prawdziwy ma pierwszeństwo przed aliasem) |
| `email_to_alias` | TAK = główny adres jest przekierowaniem (Apple/Firefox/Duck) |
| `telefon` | numer znormalizowany do `+48…` |
| `dolaczyl` | data założenia konta (`RRRR-MM-DD`) |
| `zgoda_marketing` | **TAK / NIE** — zgoda na maile marketingowe |
| `nowy_klient` | TAK = pierwsza rezerwacja u Ciebie |
| `rezerwacje_u_mnie` | liczba rezerwacji w Twojej restauracji |
| `rezerwacje_zjedzmy` | liczba rezerwacji w całym Zjedz.my |
| `zwykle_osob` | zazwyczaj przychodzi z X osób — z Twojego lokalu, a gdy panel go tam nie podaje, z całego Zjedz.my |
| `ulubiona_godzina`, `ulubiony_dzien` | preferencje |
| `ostatnia_rezerwacja_data` | `RRRR-MM-DD GG:MM` |
| `ostatnia_rezerwacja_status` | Zrealizowana / Potwierdzona / … |
| `ostatnia_rezerwacja_osob` | liczba osób |
| `liczba_kont` | ile kont Zjedz.my scalono w tę jedną osobę |
| `emaile_wszystkie` | wszystkie maile tej osoby, rozdzielone ` \| ` |
| `telefony_wszystkie` | wszystkie jej numery |

## Scalanie kont jednej osoby

Ten sam klient bywa w bazie kilka razy: raz zalogował się przez Apple (alias
`@privaterelay`), raz zwykłym mailem. Numer telefonu zwykle zostaje ten sam,
więc konta łączymy **po mailu ORAZ po telefonie, przechodnio**: jeśli konto A
i B mają ten sam mail, a B i C ten sam telefon — A, B i C to jedna osoba.

Puste pola nigdy nie łączą (inaczej wszyscy bez telefonu skleiliby się w jednego
klienta). Przy scalaniu:

- `rezerwacje_u_mnie` i `rezerwacje_zjedzmy` — **sumowane** ze wszystkich kont
- `email` — preferowany prawdziwy adres, alias tylko gdy innego nie ma
- `dolaczyl` — najwcześniejsza data
- `ostatnia_rezerwacja_*` — najpóźniejsza rezerwacja z dowolnego konta
- preferencje (godzina, dzień, liczba osób) — z konta o największej aktywności
- `zgoda_marketing` — **zgoda wygrywa** nad jej brakiem: jeśli osoba na
  którymkolwiek ze swoich kont zaznaczyła zgodę, cała scalona osoba dostaje
  `TAK`. Odwrócisz to stałą `ZGODA_OPTOUT_WYGRYWA = true` w obu skryptach.
  Kolumna `emaile_wszystkie` pozwala odtworzyć, z których kont to wyszło.

`zmDuplikaty()` w konsoli pokazuje, które konta zostały ze sobą połączone —
warto rzucić okiem, zanim wyślesz kampanię.

---

## Skąd biorą się dane: API panelu

Zakładka „Baza klientów" stoi na **server-side DataTables**, który ma własny
endpoint JSON:

```
GET https://zjedz.my/<restauracja>/profile/ajax/datatables/users?draw=1&start=0&length=500
```

Odpowiedź niesie `recordsTotal` (u nas **6 965**) i tablicę `data[]` — w niej
komplet pól klienta plus `added_details`, czyli wyrenderowaną kartę jako HTML.
Uwierzytelnia zwykłe ciasteczko sesji Laravela, więc **nigdzie nie podajesz
hasła** — leci Twoja własna, zalogowana sesja.

Zamiast przeklikiwać 697 stron po 10 pozycji bierzemy więc bazę w **14 porcjach
po 500**. Pełne rozpoznanie — parametry, model uwierzytelnienia, zmierzone czasy
i pułapki w HTML-u karty — jest w [ROZPOZNANIE.md](ROZPOZNANIE.md).

---

## Droga główna: jedno polecenie w terminalu

```bash
git clone https://github.com/gskobelski/zjedzmy_getcontacts.git
cd zjedzmy_getcontacts
npm install        # playwright + chromium, ~2 min, raz
npm start
```

Albo, gdy komputer jest cudzy i nie wiadomo, co na nim stoi —
`start.command` robi to samo, tyle że sam sprawdza, czego brakuje,
i tłumaczy każdy błąd po ludzku. Na Macu wystarczy go kliknąć dwukrotnie.

```bash
bash start.command --sprawdz    # tylko sprawdza wymagania, nic nie uruchamia
bash start.command              # sprawdza, doinstalowuje i eksportuje
```

Otworzy się okno przeglądarki na Zjedz.my.

1. **Zaloguj się w tym oknie ręcznie.** Skrypt czeka i ruszy sam — hasła nigdzie
   nie podajesz, skrypt go nie widzi.
2. Skrypt sam sprawdza, **do których restauracji ma dostęp zalogowane konto**.
   Przy jednej rusza od razu; przy kilku pyta, którą eksportować (albo robi
   wszystkie po kolei). Nic nie jest wpisane na sztywno.
3. Zostaw okno otwarte na ~10 minut. Postęp leci do terminala.
4. Na końcu obok repo pojawi się `klienci-<restauracja>.csv`.

Sesja zostaje w `.profil-przegladarki/`, więc **logujesz się tylko za pierwszym
razem** — kolejne uruchomienia ruszają od razu.

Potrzebne: **Node 18+** i konto w Zjedz.my z dostępem managerskim do lokalu.
Konkretną restaurację można też wskazać z góry, jej nazwą z adresu panelu:

```bash
npm start -- nazwa-restauracji-z-adresu
```

Przy okazji lądują w `raw/<restauracja>/` surowe odpowiedzi API. Nie są do
niczego potrzebne, ale pozwalają przeliczyć CSV jeszcze raz bez ruszania
serwera: `python3 parsuj_api.py raw/<restauracja>`.

---

## To samo bez instalowania czegokolwiek: konsola przeglądarki

Gdy na maszynie nie ma Node'a albo nie chcesz nic instalować — te same dwa
pliki można wkleić ręcznie:

1. Otwórz panel **swojej** restauracji: `https://zjedz.my/<restauracja>/profile#company-users`
2. `F12` → zakładka **Console**.
   Chrome przy pierwszym wklejeniu zażąda wpisania `allow pasting` — wpisz i Enter.
3. Wklej całą zawartość `scripts/scrape-dom.js`, Enter.
4. Wklej całą zawartość `scripts/api-scrape.js`, Enter.
5. **Zostaw kartę otwartą.** Skrypt raportuje postęp po każdej porcji
   (~45 s każda, razem ~10 min) i na końcu sam zapisze `klienci.csv`.
   Restaurację bierze z adresu otwartej strony, więc działa w każdym panelu.

`scrape-dom.js` wnosi parser karty i scalanie kont, `api-scrape.js` — pobieranie
z API. To jest dokładnie to, co `npm start` robi za Ciebie: `pobierz-api.js`
otwiera okno i wstrzykuje te dwa pliki, więc **obie drogi liczą to samo**.

Przerwanie w trakcie: `zmStop()` — zebrane dane zostają, `zmPobierz()` działa.

Komendy: `zmIle()` (konta i osoby) · `zmPodglad()` · `zmDuplikaty()` ·
`zmPobierz()` · `zmPobierzJSON()` · `zmReset()` · `zmScal()` · `zmStop()`

---

## Droga zapasowa: klikanie po DOM

Gdyby endpoint kiedyś zniknął albo zmienił format — zostaje stary sposób,
czyli czytanie kart wyrenderowanych na stronie:

1. `scripts/scrape-dom.js` — parser + `zmZbierz()` dla bieżącej strony
2. `scripts/auto-scrape.js` — przestawia listę na 100 pozycji i sam przeklikuje
   ~70 stron

Sam `scrape-dom.js` wystarczy do wariantu ręcznego: `zmZbierz()` po każdej
przeklikanej stronie, na koniec `zmPobierz()`. Powtórne zebranie tej samej strony
niczego nie psuje.

`scripts/probe-api.js` podsłuchuje ruch sieciowy strony i wypisuje zapytania
wyglądające na API — przydatne, gdyby trzeba było namierzyć nowy endpoint.

---

## Droga awaryjna: wklejka do pliku

Gdy konsola odpada — zaznacz listę (`Cmd+A`), wklej do pliku `.txt` i:

```bash
python3 parsuj_wklejke.py wklejka.txt
```

Powstanie `klienci.csv` — z tym samym scalaniem kont co wersja przeglądarkowa.
Skrypt sam znajduje granice między klientami po adresach e-mail i nie wymaga
żadnych zewnętrznych bibliotek.

---

## Zanim ruszysz z kampanią

- **Filtruj po `zgoda_marketing`.** Wysyłka mailingu do osób z `NIE` to
  naruszenie RODO i ustawy o świadczeniu usług drogą elektroniczną. Numer
  telefonu ma osobny reżim — zgoda na maile nie jest zgodą na SMS.
- **Adresy `@privaterelay.appleid.com`** to aliasy „Zaloguj przez Apple”.
  Przekierowują na prawdziwą skrzynkę, ale użytkownik może je wyłączyć
  jednym kliknięciem, a część systemów mailingowych je odrzuca. Przy takich
  kontaktach telefon jest pewniejszym kanałem.
- **Konta skasowane** (RODO) panel oddaje jako „Użytkownik usunięty" z zaślepkami
  zamiast maila i telefonu. Oba skrypty je wyrzucają — na 6 965 kontach było ich 11.
- Sprawdź w regulaminie Zjedz.my, na jakich zasadach udostępniają Ci te dane —
  eksport bazy bywa tam osobno uregulowany.

## Format CSV

Separator: **średnik** (domyślny w polskim Excelu), kodowanie UTF-8 z BOM.
Jeśli Twoje narzędzie mailingowe wymaga przecinka, zmień stałą `SEPARATOR`
na górze `scripts/scrape-dom.js` lub `parsuj_wklejke.py`.
