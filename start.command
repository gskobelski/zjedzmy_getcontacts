#!/bin/bash
# ---------------------------------------------------------------
# start.command — uruchamia eksport bazy klientow Zjedz.my.
#
# Na Macu wystarczy kliknac ten plik dwukrotnie w Finderze. Skrypt
# sam sprawdzi, czego brakuje, doinstaluje co trzeba i odpali eksport.
#
#   bash start.command --sprawdz    sam sprawdza, niczego nie uruchamia
#
# Napisany tak, zeby po kazdym niepowodzeniu mowil PO CO i CO ZROBIC,
# bo uruchamia go czesto ktos, kto nie pracuje na co dzien w terminalu.
# ---------------------------------------------------------------

cd "$(dirname "$0")" || exit 1

MINIMALNY_NODE=18
TYLKO_SPRAWDZ=0
[ "$1" = "--sprawdz" ] && TYLKO_SPRAWDZ=1

zielony() { printf '\033[32m%s\033[0m\n' "$1"; }
czerwony() { printf '\033[31m%s\033[0m\n' "$1"; }
zolty()   { printf '\033[33m%s\033[0m\n' "$1"; }

# Po dwukliku okno Terminala zamyka sie razem ze skryptem i nikt nie zdazy
# przeczytac bledu — wiec na koncu zawsze czekamy na Enter.
zakoncz() {
  echo
  echo "Nacisnij Enter, zeby zamknac to okno."
  read -r _
  exit "$1"
}

echo
echo "========================================"
echo "  Eksport bazy klientow Zjedz.my"
echo "========================================"
echo

# --- 1. Czy jest Node.js -----------------------------------------
if ! command -v node >/dev/null 2>&1; then
  czerwony "BRAKUJE: Node.js"
  echo
  echo "To jedyny program, ktory trzeba doinstalowac recznie."
  echo
  echo "  1. Otworze teraz strone nodejs.org"
  echo "  2. Pobierz duzy zielony przycisk po lewej (wersja LTS)"
  echo "  3. Zainstaluj — same 'Dalej', nic nie trzeba wybierac"
  echo "  4. ZAMKNIJ to okno i kliknij start.command jeszcze raz"
  echo
  command -v open >/dev/null 2>&1 && open "https://nodejs.org/"
  zakoncz 1
fi

WERSJA=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$WERSJA" -lt "$MINIMALNY_NODE" ]; then
  czerwony "Node.js jest za stary: masz $(node -v), potrzebna $MINIMALNY_NODE lub nowsza."
  echo
  echo "Zainstaluj nowszy z nodejs.org (wersja LTS) i uruchom ten plik ponownie."
  command -v open >/dev/null 2>&1 && open "https://nodejs.org/"
  zakoncz 1
fi
zielony "JEST: Node.js $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  czerwony "BRAKUJE: npm"
  echo "Zwykle przychodzi razem z Node.js. Zainstaluj Node.js jeszcze raz z nodejs.org."
  zakoncz 1
fi
zielony "JEST: npm $(npm -v)"

# --- 2. Czy sa doinstalowane biblioteki i przegladarka -----------
if [ -d node_modules/playwright ]; then
  zielony "JEST: biblioteki programu"
  BRAKUJE_BIBLIOTEK=0
else
  zolty "BRAKUJE: biblioteki programu (doinstaluje sie same)"
  BRAKUJE_BIBLIOTEK=1
fi

if ls "$HOME/Library/Caches/ms-playwright/chromium"* >/dev/null 2>&1; then
  zielony "JEST: przegladarka Chromium"
  BRAKUJE_PRZEGLADARKI=0
else
  zolty "BRAKUJE: przegladarka Chromium (doinstaluje sie sama, ok. 150 MB)"
  BRAKUJE_PRZEGLADARKI=1
fi

if [ "$TYLKO_SPRAWDZ" = "1" ]; then
  echo
  if [ "$BRAKUJE_BIBLIOTEK" = "1" ] || [ "$BRAKUJE_PRZEGLADARKI" = "1" ]; then
    echo "Wszystko, czego brakuje, program doinstaluje sam przy pierwszym uruchomieniu."
  else
    zielony "Komplet — mozesz uruchamiac eksport."
  fi
  zakoncz 0
fi

# --- 3. Instalacja, jesli czegos brakuje -------------------------
if [ "$BRAKUJE_BIBLIOTEK" = "1" ] || [ "$BRAKUJE_PRZEGLADARKI" = "1" ]; then
  echo
  echo "Instaluje, czego brakuje. Zajmie to ok. 2 minut i wypisze duzo tekstu —"
  echo "tak ma byc, poczekaj do konca."
  echo
  if ! npm install; then
    echo
    czerwony "Instalacja sie nie powiodla."
    echo "Najczestsza przyczyna to brak internetu. Sprawdz polaczenie i sprobuj ponownie."
    zakoncz 1
  fi
  zielony "Zainstalowane."
fi

# --- 4. Eksport --------------------------------------------------
echo
echo "----------------------------------------"
echo "Za chwile otworzy sie okno przegladarki."
echo
echo "  * Jesli poprosi o logowanie — zaloguj sie w nim RECZNIE,"
echo "    tak jak zawsze. Program czeka i ruszy sam."
echo "  * Sam wykryje, do ktorej restauracji masz dostep. Jesli masz"
echo "    kilka lokali — zapyta, ktory eksportowac."
echo "  * Potem zostaw wszystko w spokoju na ok. 10 minut."
echo "  * Nie zamykaj ani okna przegladarki, ani tego okna."
echo "----------------------------------------"
echo

if npm start; then
  echo
  zielony "Gotowe. Plik klienci-<restauracja>.csv lezy w tym samym folderze co ten skrypt."
  echo "Otworzysz go dwuklikiem w Excelu."
  echo
  zolty "Zanim ktokolwiek wysle kampanie: w pliku jest kolumna zgoda_marketing."
  echo "Osoby z wartoscia NIE trzeba odfiltrowac — inaczej lamiemy RODO."
  zakoncz 0
else
  echo
  czerwony "Eksport sie nie udal."
  echo "Uruchom ten plik jeszcze raz — najczesciej za drugim razem przechodzi."
  echo "Jesli dalej nie dziala, wyslij Gracjanowi to, co wypisalo sie powyzej."
  zakoncz 1
fi
