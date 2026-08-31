#!/usr/bin/env python3
"""Zamienia tekst skopiowany ze strony "Baza klientow" (Zjedz.my) na czysty CSV.

Plan awaryjny dla scripts/scrape-dom.js: jesli konsola przegladarki nie wchodzi
w gre, zaznacz liste klientow (Cmd+A), wklej do pliku .txt i uruchom:

    python3 parsuj_wklejke.py wklejka.txt

Wynik: klienci.csv obok pliku wejsciowego. Skrypt sam znajduje granice miedzy
kartami klientow po adresach e-mail, wiec nie musisz nic recznie rozdzielac.
"""

from __future__ import annotations

import csv
import re
import sys
import unicodedata
from pathlib import Path

# W polskim Excelu separatorem jest srednik. Dla narzedzi mailingowych
# oczekujacych przecinka — zmien na ",".
SEPARATOR = ";"

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
TELEFON = re.compile(r"(\+?\d[\d\s-]{7,}\d)")
DATA_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")

MIESIACE = {
    "stycznia": 1, "lutego": 2, "marca": 3, "kwietnia": 4, "maja": 5, "czerwca": 6,
    "lipca": 7, "sierpnia": 8, "wrzesnia": 9, "pazdziernika": 10,
    "listopada": 11, "grudnia": 12,
}

KOLUMNY = [
    "nick", "email", "email_to_alias", "telefon", "dolaczyl", "zgoda_marketing",
    "nowy_klient", "rezerwacje_u_mnie", "rezerwacje_zjedzmy", "zwykle_osob",
    "ulubiona_godzina", "ulubiony_dzien", "ostatnia_rezerwacja_data",
    "ostatnia_rezerwacja_status", "ostatnia_rezerwacja_osob",
    "liczba_kont", "emaile_wszystkie", "telefony_wszystkie",
]

# adresy-przekierowania: Apple, Firefox Relay, DuckDuckGo, SimpleLogin, AnonAddy
ALIAS_MAILA = re.compile(
    r"@(privaterelay\.appleid\.com|relay\.firefox\.com|duck\.com|simplelogin\.|anonaddy\.)",
    re.IGNORECASE,
)

# Gdy jedno konto ma zgode, a drugie nie: False = wygrywa ZGODA (raz udzielona
# liczy sie dla calej osoby). Ustaw True, jesli ma wygrywac brak zgody.
ZGODA_OPTOUT_WYGRYWA = False


def bez_ogonkow(tekst: str) -> str:
    """usuwa polskie znaki diakrytyczne — ulatwia dopasowywanie nazw miesiecy"""
    zamiana = tekst.replace("ł", "l").replace("Ł", "L")
    return "".join(c for c in unicodedata.normalize("NFD", zamiana)
                   if not unicodedata.combining(c))


def dopasuj(tekst: str, wzor: str, grupa: int = 1) -> str:
    m = re.search(wzor, tekst, re.IGNORECASE)
    return m.group(grupa).strip() if m else ""


def telefon_norm(surowy: str) -> str:
    cyfry = re.sub(r"[^\d+]", "", surowy or "")
    if not cyfry:
        return ""
    if cyfry.startswith("+"):
        return cyfry
    if len(cyfry) == 9:                       # polski numer bez kierunkowego
        return "+48" + cyfry
    if len(cyfry) == 11 and cyfry.startswith("48"):
        return "+" + cyfry
    return cyfry


def data_pl(surowa: str) -> str:
    """'niedziela, 29 marca 2026 20:15' -> '2026-03-29 20:15'"""
    m = re.search(r"(\d{1,2}) ([a-z]+) (\d{4})(?: (\d{1,2}:\d{2}))?",
                  bez_ogonkow(surowa or ""), re.IGNORECASE)
    if not m:
        return ""
    mies = MIESIACE.get(m.group(2).lower())
    if not mies:
        return ""
    iso = f"{m.group(3)}-{mies:02d}-{int(m.group(1)):02d}"
    return f"{iso} {m.group(4)}" if m.group(4) else iso


def wytnij(tekst: str, od: str | None, do: str | None) -> str:
    """fragment tekstu miedzy dwoma znacznikami (regexami)"""
    start = 0
    if od:
        m = re.search(od, tekst, re.IGNORECASE)
        if not m:
            return ""
        start = m.start()
    reszta = tekst[start:]
    if not do:
        return reszta
    m = re.search(do, reszta[1:], re.IGNORECASE)
    return reszta[: m.start() + 1] if m else reszta


def podziel_na_karty(tekst: str) -> list[str]:
    """Tnie wklejke na karty klientow — kazdy adres e-mail zaczyna nowa karte.

    Nick stoi linie WYZEJ niz e-mail, wiec ciecie cofamy o jedna linie.
    """
    linie = tekst.splitlines()
    poczatki = [i for i, linia in enumerate(linie) if EMAIL.search(linia)]
    if not poczatki:
        return []

    granice = [max(0, i - 1) for i in poczatki]
    karty = []
    for n, start in enumerate(granice):
        koniec = granice[n + 1] if n + 1 < len(granice) else len(linie)
        karty.append("\n".join(linie[start:koniec]))
    return karty


def parsuj_karte(surowy: str) -> dict[str, str] | None:
    tekst = surowy.replace(" ", " ")
    m_email = EMAIL.search(tekst)
    if not m_email:
        return None
    email = m_email.group(0)

    # Obie kolumny statystyk uzywaja tych samych etykiet ("Ulubiona godzina"),
    # wiec rozdzielamy je zanim cokolwiek wyciagniemy.
    m_granica = re.search(r"Aktywno[sś][cć] w Twojej", tekst)
    glowa = tekst[: m_granica.start()] if m_granica else tekst
    w_restauracji = wytnij(tekst, r"Aktywno[sś][cć] w Twojej", r"w Zjedz\.my")
    w_zjedzmy = wytnij(tekst, r"w Zjedz\.my", r"Ostatnie rezerwacje|Opinia")
    ostatnie = wytnij(tekst, r"Ostatnie rezerwacje", None)

    pierwsza_linia = next((l.strip() for l in surowy.splitlines() if l.strip()), "")
    nick = EMAIL.sub("", pierwsza_linia).strip() or email.split("@")[0]

    if re.search(r"Brak zgody na przesy", glowa, re.IGNORECASE):
        zgoda = "NIE"
    elif re.search(r"Zgoda na przesy", glowa, re.IGNORECASE):
        zgoda = "TAK"
    else:
        zgoda = ""

    nowy = bool(re.search(r"Nowy Klient", w_restauracji, re.IGNORECASE))

    return {
        "nick": nick,
        "email": email,
        # data "2026-02-13" tez pasuje do wzorca telefonu — usuwamy ja najpierw
        "telefon": telefon_norm(dopasuj(DATA_ISO.sub(" ", glowa), TELEFON.pattern)),
        "dolaczyl": dopasuj(glowa, r"Do[lł][aą]czy[lł]:\s*(\d{4}-\d{2}-\d{2})"),
        "zgoda_marketing": zgoda,
        "nowy_klient": "TAK" if nowy else "NIE",
        "rezerwacje_u_mnie": "1" if nowy else dopasuj(w_restauracji, r"Rezerwacje:\s*(\d+)"),
        "rezerwacje_zjedzmy": dopasuj(w_zjedzmy, r"Rezerwacje:\s*(\d+)"),
        "zwykle_osob": dopasuj(w_restauracji, r"Zazwyczaj przychodzi z\s*(\d+)"),
        "ulubiona_godzina": dopasuj(w_restauracji, r"Ulubiona godzina:\s*(\d+)"),
        "ulubiony_dzien": dopasuj(w_restauracji, r"Ulubiony dzie[nń]:\s*(\w+)"),
        "ostatnia_rezerwacja_data": data_pl(ostatnie),
        "ostatnia_rezerwacja_status": dopasuj(
            ostatnie, r"(Zrealizowana|Potwierdzona|Anulowana|Odwo[lł]ana|Oczekuj[aą]ca|Niezrealizowana)"),
        "ostatnia_rezerwacja_osob": dopasuj(ostatnie, r"(\d+)\s*os\."),
    }


# --------------------------------------------------------------------------
# Scalanie tozsamosci
#
# Ten sam czlowiek potrafi miec kilka kont: raz zaloguje sie przez Apple (alias
# @privaterelay), raz zwyklym mailem. Numer telefonu zwykle zostaje ten sam.
# Laczymy wiec konta przechodnio: A i B po mailu, B i C po telefonie => jedna
# osoba. Puste pola NIGDY nie lacza — inaczej wszyscy bez telefonu skleiliby
# sie w jednego klienta.
# --------------------------------------------------------------------------


def znajdz_grupy(rekordy: list[dict[str, str]]) -> list[list[dict[str, str]]]:
    rodzic: dict[str, str] = {}

    def znajdz(k: str) -> str:
        while rodzic[k] != k:
            rodzic[k] = rodzic[rodzic[k]]
            k = rodzic[k]
        return k

    def polacz(a: str, b: str) -> None:
        ra, rb = znajdz(a), znajdz(b)
        if ra != rb:
            rodzic[ra] = rb

    def klucze_dla(r: dict[str, str], nr: int) -> list[str]:
        k = []
        if r["email"]:
            k.append("e:" + r["email"].lower())
        if r["telefon"]:
            k.append("t:" + r["telefon"])
        return k or ["x:%d" % nr]        # brak maila i telefonu = osobna osoba

    for nr, r in enumerate(rekordy):
        klucze = klucze_dla(r, nr)
        for k in klucze:
            rodzic.setdefault(k, k)
        for k in klucze[1:]:
            polacz(klucze[0], k)

    grupy: dict[str, list[dict[str, str]]] = {}
    for nr, r in enumerate(rekordy):
        grupy.setdefault(znajdz(klucze_dla(r, nr)[0]), []).append(r)
    return list(grupy.values())


def suma_int(grupa: list[dict[str, str]], pole: str) -> str:
    liczby = [int(r[pole]) for r in grupa if r[pole].isdigit()]
    return str(sum(liczby)) if liczby else ""


def pierwsze_niepuste(grupa: list[dict[str, str]], pole: str) -> str:
    return next((r[pole] for r in grupa if r[pole]), "")


def scal_grupe(grupa: list[dict[str, str]]) -> dict[str, str]:
    emaile = list(dict.fromkeys(r["email"] for r in grupa if r["email"]))
    telefony = list(dict.fromkeys(r["telefon"] for r in grupa if r["telefon"]))

    # do kampanii wolimy prawdziwy adres niz alias przekierowujacy
    zwykle = [e for e in emaile if not ALIAS_MAILA.search(e)]
    email = (zwykle or emaile or [""])[0]

    # preferencje bierzemy z konta o najwiekszej liczbie rezerwacji — ma najwiecej danych
    wg_aktywnosci = sorted(
        grupa, key=lambda r: int(r["rezerwacje_u_mnie"]) if r["rezerwacje_u_mnie"].isdigit() else 0,
        reverse=True)
    # "ostatnia rezerwacja" to najpozniejsza ze wszystkich kont (daty ISO sortuja sie tekstowo)
    z_data = sorted((r for r in grupa if r["ostatnia_rezerwacja_data"]),
                    key=lambda r: r["ostatnia_rezerwacja_data"], reverse=True)
    najnowsze = z_data[0] if z_data else {}

    zgody = {r["zgoda_marketing"] for r in grupa if r["zgoda_marketing"]}
    if ZGODA_OPTOUT_WYGRYWA:
        zgoda = "NIE" if "NIE" in zgody else ("TAK" if "TAK" in zgody else "")
    else:
        zgoda = "TAK" if "TAK" in zgody else ("NIE" if "NIE" in zgody else "")

    daty = sorted(r["dolaczyl"] for r in grupa if r["dolaczyl"])
    rezerwacje_u_mnie = suma_int(grupa, "rezerwacje_u_mnie")

    return {
        "nick": pierwsze_niepuste(wg_aktywnosci, "nick"),
        "email": email,
        "email_to_alias": "TAK" if email and ALIAS_MAILA.search(email) else "NIE",
        "telefon": telefony[0] if telefony else "",
        "dolaczyl": daty[0] if daty else "",       # najwczesniejsza data zalozenia konta
        "zgoda_marketing": zgoda,
        "nowy_klient": "NIE" if (rezerwacje_u_mnie.isdigit() and int(rezerwacje_u_mnie) > 1) else "TAK",
        "rezerwacje_u_mnie": rezerwacje_u_mnie,
        "rezerwacje_zjedzmy": suma_int(grupa, "rezerwacje_zjedzmy"),
        "zwykle_osob": pierwsze_niepuste(wg_aktywnosci, "zwykle_osob"),
        "ulubiona_godzina": pierwsze_niepuste(wg_aktywnosci, "ulubiona_godzina"),
        "ulubiony_dzien": pierwsze_niepuste(wg_aktywnosci, "ulubiony_dzien"),
        "ostatnia_rezerwacja_data": najnowsze.get("ostatnia_rezerwacja_data", ""),
        "ostatnia_rezerwacja_status": najnowsze.get("ostatnia_rezerwacja_status", ""),
        "ostatnia_rezerwacja_osob": najnowsze.get("ostatnia_rezerwacja_osob", ""),
        "liczba_kont": str(len(grupa)),
        "emaile_wszystkie": " | ".join(emaile),
        "telefony_wszystkie": " | ".join(telefony),
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 1

    wejscie = Path(argv[1])
    if not wejscie.is_file():
        print(f"Nie znalazlem pliku: {wejscie}", file=sys.stderr)
        return 1

    wyjscie = Path(argv[2]) if len(argv) > 2 else wejscie.with_name("klienci.csv")
    tekst = wejscie.read_text(encoding="utf-8", errors="replace")

    # mail+telefon jako klucz — ta sama karta wklejona dwa razy liczy sie raz.
    # Scalanie roznych kont tej samej osoby robimy dopiero nizej.
    konta: dict[str, dict[str, str]] = {}
    pominiete = 0
    for karta in podziel_na_karty(tekst):
        wiersz = parsuj_karte(karta)
        if wiersz is None:
            pominiete += 1
            continue
        konta[f"{wiersz['email']}|{wiersz['telefon']}"] = wiersz

    if not konta:
        print("Nie znalazlem zadnego klienta — czy plik na pewno zawiera wklejona liste?",
              file=sys.stderr)
        return 1

    grupy = znajdz_grupy(list(konta.values()))
    osoby = sorted(
        (scal_grupe(g) for g in grupy),
        key=lambda w: int(w["rezerwacje_u_mnie"]) if w["rezerwacje_u_mnie"].isdigit() else 0,
        reverse=True)

    # BOM, zeby Excel poprawnie pokazal polskie znaki
    with wyjscie.open("w", encoding="utf-8-sig", newline="") as f:
        pisarz = csv.DictWriter(f, fieldnames=KOLUMNY, delimiter=SEPARATOR)
        pisarz.writeheader()
        pisarz.writerows(osoby)

    sklejone = sum(1 for g in grupy if len(g) > 1)
    print(f"Zapisano {wyjscie}")
    print(f"  kont w zrodle: {len(konta)}   (pominietych fragmentow: {pominiete})")
    print(f"  OSOB po scaleniu: {len(osoby)}   (scalono kont w {sklejone} osobach)")
    print(f"  ze zgoda marketingowa: {sum(1 for w in osoby if w['zgoda_marketing'] == 'TAK')}")
    print(f"  z numerem telefonu: {sum(1 for w in osoby if w['telefon'])}")
    print(f"  z prawdziwym mailem (nie alias): {sum(1 for w in osoby if w['email_to_alias'] == 'NIE')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
