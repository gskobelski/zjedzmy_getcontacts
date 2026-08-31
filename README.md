# zjedzmy_getcontacts

Wyciąganie bazy klientów z panelu Zjedz.my (`/profile#company-users`) do CSV
nadającego się do kampanii mailowych i SMS.

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
| `zwykle_osob` | zazwyczaj przychodzi z X osób |
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

## Cel: 6 965 kontaktów

Panel stoi na **jQuery DataTables** — stopka „Pozycje od 1 do 10 z 6 965
łącznie", przełącznik „Pokaż X pozycji", strony 1…697. Skrypt przestawia
listę na 100 pozycji i sam przeklikuje ~70 stron.

## Droga główna: konsola przeglądarki

Skrypt działa **Twoją własną, zalogowaną sesją** — nigdzie nie podajesz hasła.

1. Otwórz `https://zjedz.my/tygryz-restauracja-poznan/profile#company-users`
2. `F12` → zakładka **Console**.
   Chrome przy pierwszym wklejeniu zażąda wpisania `allow pasting` — wpisz i Enter.
3. Wklej całą zawartość `scripts/scrape-dom.js`, Enter.
4. Wklej całą zawartość `scripts/auto-scrape.js`, Enter.
5. **Zostaw kartę otwartą i poczekaj.** Skrypt raportuje postęp po każdej
   stronie i na końcu sam zapisze `klienci.csv`.

Przerwanie w trakcie: `zmStop()` — zebrane dane zostają, `zmPobierz()` działa.

Jeśli na koniec skrypt ostrzeże, że zebrał mniej niż 6 965 — odpal
`auto-scrape.js` jeszcze raz. Dozbiera brakujące, duplikaty odpadają same.

### Wariant ręczny

Sam `scrape-dom.js` bez auto-paginacji: `zmZbierz()` po każdej ręcznie
przeklikanej stronie, na koniec `zmPobierz()`. Powtórne zebranie tej samej
strony niczego nie psuje.

Komendy: `zmZbierz()` · `zmIle()` (konta i osoby) · `zmPodglad()` ·
`zmDuplikaty()` · `zmPobierz()` · `zmPobierzJSON()` · `zmReset()` ·
`zmScal()` · `zmParsuj(tekst)` · `zmStop()`

### Jeśli liczba kart się nie zgadza

Strona mogła zmienić układ HTML. Odpal wtedy `scripts/probe-api.js` (instrukcja
w nagłówku pliku) — podsłuchuje zapytania sieciowe i pokazuje, czy istnieje
endpoint API zwracający listę klientów w JSON. Z takim adresem da się pobrać
wszystko jednym zapytaniem, bez scrapowania HTML.

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
- Sprawdź w regulaminie Zjedz.my, na jakich zasadach udostępniają Ci te dane —
  eksport bazy bywa tam osobno uregulowany.

## Format CSV

Separator: **średnik** (domyślny w polskim Excelu), kodowanie UTF-8 z BOM.
Jeśli Twoje narzędzie mailingowe wymaga przecinka, zmień stałą `SEPARATOR`
na górze `scripts/scrape-dom.js` lub `parsuj_wklejke.py`.
