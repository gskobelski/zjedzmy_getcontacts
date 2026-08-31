# Brief do wklejenia w narzędziu z dostępem do przeglądarki

Skopiuj wszystko poniżej linii.

---

## Kontekst

Jestem właścicielem restauracji „Tygryz" w Poznaniu. Korzystam z platformy
rezerwacyjnej **Zjedz.my** i mam tam konto managerskie do własnego lokalu.
W panelu jest zakładka **„Baza klientów"** z listą moich klientów — to moje
dane biznesowe, do których mam pełny, legalny dostęp jako właściciel konta.

Adres: `https://zjedz.my/tygryz-restauracja-poznan/profile#company-users`

Baza liczy kilka tysięcy kontaktów. Panel pokazuje je jako karty, stronami —
przeklikanie tego ręcznie jest niewykonalne.

## Cel

Wyeksportować całą bazę klientów do CSV, żeby móc prowadzić kampanie mailowe
i SMS-owe. Z każdej karty klienta potrzebuję:

- nick / nazwa użytkownika
- adres e-mail
- numer telefonu
- data dołączenia
- **zgoda na maile marketingowe** (na karcie: „Zgoda na przesyłanie maili
  w celach marketingowych" albo „Brak zgody na przesyłanie maili...")
- liczba rezerwacji w mojej restauracji oraz w całym Zjedz.my
- zazwyczaj przychodzi z X osób, ulubiona godzina, ulubiony dzień
- ostatnia rezerwacja: data, status (Zrealizowana / Potwierdzona / …), liczba osób

## O co proszę

Zaloguj się na moje konto w Zjedz.my, wejdź na zakładkę „Baza klientów"
i **zbadaj, jak ta strona jest technicznie zbudowana**. Potrzebuję instrukcji,
na podstawie której zbuduję sobie własny eksporter. Konkretnie:

1. **Czy istnieje API zwracające listę klientów w JSON?**
   Zajrzyj w zakładkę Network (XHR/Fetch) przy ładowaniu listy i przy
   przechodzeniu na kolejną stronę. Jeśli tak, podaj:
   - pełny URL endpointu i metodę (GET/POST)
   - parametry, zwłaszcza te odpowiedzialne za stronicowanie
     (`page`, `offset`, `limit`, `per_page`, kursor…)
   - **przykładową odpowiedź JSON dla 1–2 klientów** (możesz zanonimizować
     maile i telefony, ważna jest struktura i nazwy pól)
   - czy odpowiedź zawiera całkowitą liczbę rekordów lub liczbę stron
     (np. `meta.pagination.total_pages`)

2. **Który to model uwierzytelnienia?** Proszę o wskazanie jednego z czterech:
   - **Bearer token** — jak nazywa się pole z tokenem w odpowiedzi logowania
     (`token`, `access_token`, `authToken`…)? Gdzie SPA go trzyma?
   - **samo ciasteczko sesji** — jak się nazywa?
   - **ciasteczko + CSRF** (token w ukrytym polu formularza lub atrybucie
     `data-csrf`, wysyłany z powrotem przy POST)
   - **coś innego** — opisz sekwencję żądań przy logowaniu

3. **Czy da się wziąć wszystko naraz?** Zanim uznamy pętlę po stronach za
   jedyną drogę: co się stanie, jeśli podbić parametr rozmiaru strony do
   500 albo 5000? Niektóre API oddają wtedy całość jednym żądaniem. To ważne
   pytanie — każda kolejna strona to dodatkowy punkt awarii.

4. **Czy wystarczy zwykły klient HTTP, czy potrzeba przeglądarki?**
   Sprawdź, czy to samo żądanie do API przechodzi z `curl`/`httpx`
   z realistycznymi nagłówkami, mając ciasteczka/token skopiowane z sesji.
   Uwaga na charakterystyczny objaw: jeśli **poprawne** dane logowania dają
   z `curl` błąd „złe hasło", a w przeglądarce działają — to fingerprinting
   TLS albo WAF i trzeba sterować prawdziwą przeglądarką. Napisz, który
   przypadek zachodzi.

5. **Jeśli API nie ma** — opisz strukturę HTML:
   - selektor CSS kontenera pojedynczej karty klienta
   - selektor lub sposób dotarcia do każdego z pól z listy powyżej
   - fragment surowego HTML jednej karty

6. **Jak działa stronicowanie?** Przyciski „następna", numery stron,
   nieskończone przewijanie, a może parametr w URL? Ile kart przypada
   na stronę i ile jest stron łącznie?

7. **Czy są limity** — throttling, captcha, blokada po zbyt wielu
   zapytaniach? Ile żądań na minutę jest bezpieczne?

8. Czy w panelu jest gdzieś **gotowy przycisk eksportu** do CSV/XLS,
   którego nie zauważyłem? To by rozwiązało sprawę najprościej.

**Format odpowiedzi:** techniczna notatka, którą wkleję innemu asystentowi
piszącemu kod. Im więcej konkretów (URL-e, nazwy pól, surowy JSON/HTML),
tym lepiej. Nie musisz pisać gotowego programu — potrzebuję rozpoznania.
