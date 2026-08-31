# Rozpoznanie panelu „Baza klientów" — odpowiedzi na BRIEF.md

Zbadane 30 sierpnia 2026 na koncie managerskim restauracji Tygryz, przez
prawdziwą przeglądarkę (Playwright, sterowany Chromium) na zalogowanej sesji.

**Krótko: API istnieje, jest wygodne, a cała baza schodzi w ~14 zapytaniach.**
Scrapowanie DOM-u i przeklikiwanie 697 stron jest niepotrzebne.

---

## 1. Czy istnieje API zwracające listę klientów w JSON

Tak. Panel stoi na **server-side jQuery DataTables**, który ma własny endpoint:

```
GET https://zjedz.my/<restauracja>/profile/ajax/datatables/users
```

dla nas: `https://zjedz.my/tygryz-restauracja-poznan/profile/ajax/datatables/users`

### Parametry

Liczą się tylko trzy; resztę (`columns[…]`, `search[…]`) panel wysyła z rozpędu
i można ją pominąć.

| parametr | rola |
|---|---|
| `start` | offset — numer pierwszego rekordu (0, 500, 1000, …) |
| `length` | ile rekordów w odpowiedzi (panel domyślnie 10) |
| `draw` | licznik zapytania, DataTables odbija go w odpowiedzi; wystarczy `1` |

Stronicowanie jest więc **offsetowe, nie kursorowe**. Sortowanie zadaje się przez
`order[0][column]` + `columns[0][name]`; domyślne (bez tych parametrów) to `id`
rosnąco i jest stabilne — sprawdzone porównaniem `start=0` i `start=4`. Przy
stronicowaniu stabilna kolejność jest obowiązkowa, inaczej część rekordów
przepada między porcjami, więc w skryptach zadajemy ją jawnie:

```
&columns[0][data]=id&columns[0][name]=id&columns[0][orderable]=true
&order[0][column]=0&order[0][dir]=asc
```

### Odpowiedź

```json
{
  "draw": 1,
  "recordsTotal": 6965,
  "recordsFiltered": 6965,
  "data": [
    {
      "id": 527,
      "first_name": "Anna",
      "last_name": "Przykladowa",
      "email": "anna@example.com",
      "phone": "+48500100200",
      "notify_food_preferences": 0,
      "mailing_external": 1,
      "locale": "pl",
      "created_at": "2019-05-20T19:52:24.000000Z",
      "reservations_count": 1,
      "allergies": [],
      "diets": [],
      "added_details": "<div class=\"d-flex …\">…cała karta klienta jako HTML…</div>"
    }
  ]
}
```

`recordsTotal` = **6965** — czyli tyle, ile obiecuje stopka tabeli. Liczby stron
odpowiedź nie podaje, ale przy własnym `length` i tak jest niepotrzebna.

Mapowanie na kolumny CSV:

| pole z briefu | skąd |
|---|---|
| nick | `first_name` + `last_name` |
| e-mail | `email` |
| telefon | `phone` (już w formacie `+48…`) |
| data dołączenia | `created_at` |
| **zgoda na maile marketingowe** | `mailing_external` (1/0) |
| liczba rezerwacji u mnie | `reservations_count` |
| liczba rezerwacji w Zjedz.my | tylko w `added_details` |
| zwykle osób, ulubiona godzina/dzień | tylko w `added_details` |
| ostatnia rezerwacja: data, status, osoby | tylko w `added_details` |

`mailing_external` sprawdziliśmy na 1000 kartach przeciwko zdaniu „Zgoda na
przesyłanie maili w celach marketingowych" z HTML-a — **zero rozjazdów**.
`parsuj_api.py` trzyma tę kontrolę na stałe i krzyczy, gdyby kiedyś się rozjechało.

### Haczyk: `added_details`

Serwer dokleja do każdego rekordu **wyrenderowaną kartę klienta jako HTML**
(~12 KB na osobę). Stąd cała waga odpowiedzi i cały jej czas. Części danych
(rezerwacje w całym Zjedz.my, preferencje, ostatnia rezerwacja) nie ma nigdzie
indziej, więc trzeba to sparsować — robi to `parsuj_api.py`.

Dwie pułapki wykryte na danych:

- Karta ma **dwie kolumny z tymi samymi etykietami** („Ulubiona godzina",
  „Zazwyczaj przychodzi z") — osobno dla Twojej restauracji i osobno dla całego
  Zjedz.my. Trzeba je rozdzielić przed czytaniem. „Zazwyczaj przychodzi z" na 500
  kart było 128 razy **tylko** w kolumnie Zjedz.my, a tam gdzie było w obu,
  w 145 przypadkach wartości się różniły.
- Kafelki w „Ostatnie rezerwacje" **nie są ułożone chronologicznie** — na 148 kart
  z więcej niż jedną rezerwacją 7 miało najnowszą niżej niż na pierwszym miejscu.
  Trzeba przejrzeć wszystkie i wziąć maksimum daty.

## 2. Model uwierzytelnienia

**Samo ciasteczko sesji.** Zwykły Laravel, żadnego bearer tokena.

- `zjedzmy_session` — ciasteczko sesji, `HttpOnly`, `Secure`, `SameSite=None`
- `remember_web_59ba36addc…` — „zapamiętaj mnie", też `HttpOnly`
- `XSRF-TOKEN` — dostępne dla JS, plus `<meta name="csrf-token">` w HTML

W `localStorage` i `sessionStorage` **nie ma żadnego tokena** (siedzą tam tylko
klucze Google Analytics). Logowanie to zwyczajny `POST /login` kończący się
przekierowaniem 302 — nie zwraca JSON-a z tokenem.

CSRF dotyczy tylko żądań zmieniających stan. Interesujący nas endpoint to GET,
więc **wystarczy ciasteczko sesji**.

## 3. Czy da się wziąć wszystko naraz

Praktycznie tak, ale nie warto — i to nie serwer jest tu ograniczeniem, tylko
waga odpowiedzi.

| `length` | czas | rozmiar |
|---|---|---|
| 2 | 0,4 s | 27 KB |
| 500 | ~44 s | 6,5 MB |
| 6965 (szacunek) | ~10 min | ~93 MB |

Żadnego twardego limitu `length` nie napotkaliśmy — 500 przechodzi bez mrugnięcia,
a serwer nie przycina wyniku. Ale ~13 KB na rekord (to ten HTML z punktu 1) sprawia,
że jedno żądanie na całość to 93 MB wiszące 10 minut na jednym połączeniu:
**jeden timeout i tracisz wszystko**. Porcje po 500 to 14 zapytań, z których każde
jest osobnym punktem zapisu — przerwane pobieranie wznawia się od ostatniej porcji.
Testu `length=5000` świadomie nie robiliśmy, żeby nie obciążać serwera bez potrzeby.

## 4. Czy wystarczy zwykły klient HTTP

**Wystarczy `curl`.** Sprawdzone: z ciasteczkami skopiowanymi z sesji i nagłówkiem
`X-Requested-With: XMLHttpRequest` endpoint oddaje HTTP 200 i poprawny JSON
w 0,4 s. Bez ciasteczek — HTTP 403.

Objawu z briefu (poprawne hasło odrzucane przez `curl`, działające w przeglądarce)
**nie ma**. Żadnego fingerprintingu TLS ani WAF-a nie widać.

Mimo to nasze skrypty i tak strzelają przez przeglądarkę — nie z konieczności,
tylko dlatego, że tak nie trzeba nigdzie przepisywać ciasteczek ani podawać hasła.

## 5. Struktura HTML

Nieaktualne — API załatwia sprawę. Parsowanie DOM-u zostaje w repo jako
`scripts/scrape-dom.js` + `scripts/auto-scrape.js` na wypadek, gdyby endpoint
kiedyś zniknął.

## 6. Stronicowanie

W panelu: klasyczne numerowane strony DataTables (domyślnie 10 pozycji, przy
6965 rekordach daje 697 stron) plus przełącznik „Pokaż X pozycji". Pod spodem
to zwykłe `start`/`length` z punktu 1 — przy 500 na porcję zostaje **14 zapytań**.

## 7. Limity

Żadnych nie napotkaliśmy: ani captcha, ani 429, ani blokady. Pobraliśmy całe 6965
rekordów w 14 zapytaniach z 2-sekundową przerwą między nimi i wszystko przeszło
za pierwszym razem.

To jednak nie jest dowód, że limitów nie ma — po prostu nie zbliżyliśmy się do
nich. Przy tempie „porcja 500 co ~45 s" to i tak grubo poniżej jednego zapytania
na minutę, więc nie ma powodu przyspieszać. Zapytania są ciężkie dla serwera
(renderuje 500 kart HTML), więc niech tak zostanie.

## 8. Gotowy eksport w panelu

Nie znaleźliśmy żadnego przycisku eksportu do CSV/XLS na zakładce „Baza klientów" —
tabela ma tylko wyszukiwarkę, przełącznik liczby pozycji i stronicowanie.
