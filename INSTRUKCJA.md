# Jak uruchomić eksport na nowym komputerze

Instrukcja dla kogoś, kto nie pracuje na co dzień w terminalu.
Napisana pod Maca — pod Windowsem różni się tylko sposób otwierania okna
poleceń (jest o tym na końcu). Kto ma gita i czuje się w terminalu
swobodnie, znajdzie skrót zaraz pod tym akapitem.

Efekt: plik **`klienci.csv`** z całą bazą klientów, gotowy do otwarcia
w Excelu. Cała rzecz zajmuje ok. 15 minut, z czego Twojej uwagi wymaga
pierwsza — reszta dzieje się sama.

**Czego potrzebujesz:** własnego konta w Zjedz.my z dostępem managerskim
do lokalu. Logujesz się nim sam, w okienku przeglądarki — nikt nie
przekazuje Ci hasła i nigdzie go nie wpisujesz w terminalu.

---

## Skrót dla kogoś, kto ma gita i terminal

Trzy linijki i tyle:

```bash
git clone https://github.com/gskobelski/zjedzmy_getcontacts.git
cd zjedzmy_getcontacts
npm install && npm start
```

Otworzy się okno przeglądarki — zaloguj się w nim ręcznie, dalej program
radzi sobie sam przez ok. 10 minut. Efekt: `klienci.csv` w folderze repo.
Brakuje Node.js 18+? `bash start.command --sprawdz` powie, czego brakuje.

Klonowanie ma nad pobraniem ZIP-a tę przewagę, że poprawki dociągniesz
przez `git pull` zamiast pobierać wszystko od nowa.

Reszta tej instrukcji jest dla kogoś, kto nie pracuje w terminalu — jeśli
powyższe zadziałało, możesz ją pominąć i przeskoczyć od razu do
[sekcji o zgodach](#zanim-ktokolwiek-wyśle-kampanię).

---

## Krok 0. Pobierz program

Najprościej bez żadnych narzędzi:

1. Wejdź na `https://github.com/gskobelski/zjedzmy_getcontacts`
   (musisz być zalogowany na GitHubie — repozytorium jest prywatne,
   więc najpierw przyjmij zaproszenie, które dostałeś mailem)
2. Zielony przycisk **Code** → **Download ZIP**
3. Rozpakuj pobrany plik dwuklikiem
4. Przenieś powstały folder tam, gdzie go znajdziesz — np. na Pulpit

Folder będzie się nazywał `zjedzmy_getcontacts-main`.

> Jeśli masz zainstalowanego gita, zamiast tego wystarczy:
> `git clone https://github.com/gskobelski/zjedzmy_getcontacts.git`

---

## Krok 1. Sprawdź, co już masz

W folderze jest plik **`start.command`**. Umie sam sprawdzić, czego brakuje,
niczego przy tym nie uruchamiając.

1. Otwórz **Terminal** (Cmd + spacja, wpisz „Terminal", Enter)
2. Wpisz `cd ` — ze spacją na końcu — a potem **przeciągnij folder programu
   na okno Terminala**. Ścieżka wpisze się sama. Naciśnij Enter.
3. Wpisz i zatwierdź:

```
bash start.command --sprawdz
```

Zobaczysz listę w rodzaju:

```
JEST: Node.js v22.11.0
JEST: npm 10.9.0
BRAKUJE: biblioteki programu (doinstaluje sie same)
BRAKUJE: przegladarka Chromium (doinstaluje sie sama, ok. 150 MB)
```

**Liczy się tylko pierwsza linia.** Wszystko oznaczone jako
„doinstaluje się samo" program załatwi za Ciebie w kroku 3 — nie musisz
z tym nic robić.

---

## Krok 2. Zainstaluj Node.js — o ile go nie ma

To jedyny program do zainstalowania ręcznie. Jeśli w kroku 1 zobaczyłeś
`JEST: Node.js` z numerem **18 lub wyższym** — pomiń ten krok.

1. Wejdź na **[nodejs.org](https://nodejs.org)**
2. Kliknij duży przycisk z dopiskiem **LTS** (to wersja stabilna)
3. Otwórz pobrany plik i przeklikaj instalator — same „Dalej",
   niczego nie trzeba wybierać
4. **Zamknij okno Terminala i otwórz je na nowo** — bez tego Terminal
   dalej nie będzie widział Node'a

Potem powtórz krok 1, żeby się upewnić, że jest.

---

## Krok 3. Uruchom eksport

W tym samym oknie Terminala, w folderze programu:

```
bash start.command
```

To wszystko. Program sam doinstaluje resztę (za pierwszym razem ok. 2 minuty
i sporo tekstu na ekranie — tak ma być), a potem otworzy okno przeglądarki.

**Zaloguj się w tym oknie ręcznie**, tak jak zawsze wchodzisz do panelu
Zjedz.my. Program czeka i ruszy sam, gdy tylko znajdziesz się w środku.
Za drugim razem logowanie już Cię nie zapyta.

Dalej zostaw wszystko w spokoju na **ok. 10 minut**. Nie zamykaj ani okna
przeglądarki, ani okna Terminala. W Terminalu będą pojawiać się linie postępu:

```
[api] 500/6966 kont | OSOB: 499
[api] 1000/6966 kont | OSOB: 997
```

> **`proba 1 nieudana: Failed to fetch` to nie awaria.** Serwer Zjedz.my
> czasem urywa jedno zapytanie; program powtarza je do trzech razy i idzie
> dalej. Reaguj dopiero, gdy napisze wprost, że się poddaje.

Na koniec w folderze programu pojawi się **`klienci.csv`** — jeden wiersz
na osobę, ok. 6 800 wierszy. Otwiera się dwuklikiem w Excelu, polskie znaki
i kolumny wchodzą same.

### Można też bez Terminala

Na Macu `start.command` da się po prostu kliknąć dwukrotnie w Finderze.
Za pierwszym razem system uzna plik za pobrany z internetu i odmówi
otwarcia — wtedy **kliknij go prawym przyciskiem → Otwórz** i potwierdź
w okienku. Kolejne razy działają zwykłym dwuklikiem.

---

## Gdy coś nie działa

| Co widzisz | Co zrobić |
|---|---|
| `command not found: node` | Node.js nie jest zainstalowany albo Terminal go jeszcze nie widzi — wróć do kroku 2 i pamiętaj, żeby zamknąć i otworzyć okno Terminala na nowo |
| `No such file or directory` po `bash start.command` | Terminal nie stoi w folderze programu. Powtórz punkt 2 z kroku 1: `cd ` + przeciągnięcie folderu |
| `Repository not found` przy pobieraniu | Nie masz jeszcze dostępu do repozytorium albo nie przyjąłeś zaproszenia — sprawdź maila z GitHuba |
| Okno przeglądarki zamknęło się w trakcie | Uruchom `bash start.command` jeszcze raz. Pobieranie zacznie się od początku, ale logować się już nie musisz |
| „brakuje N kont" na końcu | Uruchom jeszcze raz. Osobna informacja o **pominiętych kontach skasowanych** to co innego — tak ma być |
| Instalacja przerywa się z błędem sieci | Sprawdź internet i spróbuj ponownie |

---

## Zanim ktokolwiek wyśle kampanię

W pliku jest kolumna **`zgoda_marketing`**. Wysyłka mailingu do osób
z wartością `NIE` narusza RODO i ustawę o świadczeniu usług drogą
elektroniczną — trzeba je odfiltrować. Zgoda na maile nie jest przy tym
zgodą na SMS-y; numer telefonu ma osobny reżim.

Plik zawiera dane osobowe kilku tysięcy osób. Nie trafia do repozytorium
(jest wykluczony z gita) i nie powinien krążyć mailem ani po dyskach
chmurowych bez potrzeby.

---

## Windows i Linux

`start.command` jest napisany pod Maca. Na innych systemach zainstaluj
Node.js z [nodejs.org](https://nodejs.org), otwórz okno poleceń
(Windows: PowerShell) w folderze programu i wpisz po kolei:

```
npm install
npm start
```

Reszta — okno przeglądarki, ręczne logowanie, ok. 10 minut czekania —
wygląda tak samo. Ta droga nie była testowana pod Windowsem, więc gdyby
coś odmówiło współpracy, daj znać Gracjanowi.

---

Więcej o tym, jak to działa i skąd biorą się dane: [README.md](README.md)
oraz [ROZPOZNANIE.md](ROZPOZNANIE.md).
