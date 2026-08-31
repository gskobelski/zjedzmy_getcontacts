#!/usr/bin/env python3
"""Zamienia surowe odpowiedzi API Zjedz.my na klienci.csv.

Panel "Baza klientow" stoi na server-side jQuery DataTables i ma wlasny
endpoint JSON (opis w README, sekcja "Droga najkrotsza"). scripts/pobierz-api.js
zapisuje jego odpowiedzi do katalogu raw/ — ten skrypt je czyta:

    python3 parsuj_api.py raw/

Wiekszosc pol jest w JSON-ie wprost. Reszta (rezerwacje w calym Zjedz.my,
preferencje, ostatnia rezerwacja) siedzi w polu `added_details`, ktore serwer
oddaje jako gotowy HTML karty klienta — stad parser HTML ponizej.

Scalanie kont jednej osoby, normalizacja telefonu i zapis CSV sa wspolne
z parsuj_wklejke.py — importujemy je stamtad, zeby obie drogi dawaly
identyczny wynik.
"""

from __future__ import annotations

import csv
import html
import json
import re
import sys
from pathlib import Path

from parsuj_wklejke import (
    ALIAS_MAILA, KOLUMNY, SEPARATOR,
    data_pl, dopasuj, scal_grupe, telefon_norm, wytnij, znajdz_grupy,
)

# Konta skasowane (RODO) panel oddaje z zaslepkami: nick "Uzytkownik usuniety",
# mail w domenie @zjedz.my, telefon +48123456789. Wspolna zaslepka telefonu
# sklejalaby je scalaniem w jedna fikcyjna osobe — i tak nie sa kontaktem
# do kampanii, wiec wypadaja wczesniej.
def konto_usuniete(r: dict) -> bool:
    return ((r.get("email") or "").lower().endswith("@zjedz.my")
            or "usuni" in (r.get("first_name") or "").lower())


STATUS = (r"(Zrealizowana|Potwierdzona|Anulowana|Oczekuj[aą]ca|Niezrealizowana|Nowa|Odrzucona"
          r"|Odwo[lł]ana(?: przez (?:klienta|restauracj[eę]))?)")


def html_na_tekst(kod: str) -> str:
    """HTML karty klienta -> tekst z zachowanymi granicami linii"""
    bez = re.sub(r"<(script|style|select)\b.*?</\1>", " ", kod or "", flags=re.S | re.I)
    bez = re.sub(r"<br\s*/?>|</(div|p|li|h\d|tr|a)>", "\n", bez, flags=re.I)
    bez = re.sub(r"<[^>]+>", " ", bez)
    bez = html.unescape(bez).replace(" ", " ")
    bez = re.sub(r"[ \t]+", " ", bez)
    return "\n".join(l.strip() for l in bez.splitlines() if l.strip())


def ostatnia_rezerwacja(kod: str) -> dict[str, str]:
    """Najpozniejsza rezerwacja z sekcji "Ostatnie rezerwacje".

    Kafelki NIE sa tam ulozone chronologicznie (na probce 7 kart na 148 mialo
    nowsza rezerwacje nizej), wiec przegladamy wszystkie i bierzemy maksimum.
    Daty sa w ISO, wiec sortowanie tekstowe wystarczy.
    """
    sekcja = kod[kod.find("Ostatnie rezerwacje"):] if "Ostatnie rezerwacje" in kod else ""
    if not sekcja:
        return {}
    najlepszy = None
    for kafelek in re.split(r'<a[^>]+href="https://zjedz\.my/c/', sekcja)[1:]:
        t = html_na_tekst(kafelek)
        data = data_pl(t)
        if not data:
            continue
        if najlepszy is None or data > najlepszy["ostatnia_rezerwacja_data"]:
            najlepszy = {
                "ostatnia_rezerwacja_data": data,
                "ostatnia_rezerwacja_status": dopasuj(t, STATUS).strip(),
                "ostatnia_rezerwacja_osob": dopasuj(t, r"(\d+)\s*os\."),
            }
    return najlepszy or {}


def rekord_na_wiersz(r: dict) -> dict[str, str]:
    kod = r.get("added_details") or ""
    tekst = html_na_tekst(kod)

    granica = re.search(r"Aktywno[sś][cć] w Twojej", tekst)
    glowa = tekst[: granica.start()] if granica else tekst
    w_restauracji = wytnij(tekst, r"Aktywno[sś][cć] w Twojej", r"w Zjedz\.my")
    w_zjedzmy = wytnij(tekst, r"w Zjedz\.my", r"Opinia|Ostatnie rezerwacje")

    # Zgoda: pole mailing_external z JSON-a jest zrodlem prawdy, tekst karty
    # sluzy za kontrole (rozjazdy raportuje main()).
    if re.search(r"Brak zgody na przesy", glowa, re.IGNORECASE):
        zgoda_html = "NIE"
    elif re.search(r"Zgoda na przesy", glowa, re.IGNORECASE):
        zgoda_html = "TAK"
    else:
        zgoda_html = ""

    nick = " ".join(x for x in (r.get("first_name") or "", r.get("last_name") or "") if x).strip()
    email = (r.get("email") or "").strip()
    u_mnie = r.get("reservations_count")
    nowy = bool(re.search(r"Nowy Klient", w_restauracji, re.IGNORECASE))

    return {
        "nick": nick or email.split("@")[0],
        "email": email,
        "telefon": telefon_norm(r.get("phone") or ""),
        "dolaczyl": (r.get("created_at") or "")[:10],
        "zgoda_marketing": "TAK" if r.get("mailing_external") else "NIE",
        "_zgoda_html": zgoda_html,
        "nowy_klient": "TAK" if nowy else "NIE",
        "rezerwacje_u_mnie": str(u_mnie) if isinstance(u_mnie, int) else "",
        "rezerwacje_zjedzmy": dopasuj(w_zjedzmy, r"Rezerwacje:\s*(\d+)"),
        "zwykle_osob": dopasuj(w_restauracji, r"Zazwyczaj przychodzi z\s*(\d+)")
                       or dopasuj(w_zjedzmy, r"Zazwyczaj przychodzi z\s*(\d+)"),
        "ulubiona_godzina": dopasuj(w_restauracji, r"Ulubiona godzina:\s*(\d+)"),
        "ulubiony_dzien": dopasuj(w_restauracji, r"Ulubiony dzie[nń]:\s*(\w+)"),
        "_id": str(r.get("id", "")),
        **{k: "" for k in ("ostatnia_rezerwacja_data", "ostatnia_rezerwacja_status",
                           "ostatnia_rezerwacja_osob")},
        **ostatnia_rezerwacja(kod),
    }


def wczytaj(katalog: Path) -> list[dict]:
    pliki = sorted(katalog.glob("batch-*.json"))
    if not pliki:
        raise SystemExit(f"Brak plikow batch-*.json w {katalog}")
    wg_id: dict[int, dict] = {}
    total = None
    for p in pliki:
        j = json.loads(p.read_text(encoding="utf-8"))
        total = j.get("recordsTotal", total)
        for r in j.get("data", []):
            wg_id[r["id"]] = r          # powtorka tego samego id nadpisuje, nie dubluje
    print(f"  porcji na dysku: {len(pliki)}   kont surowych: {len(wg_id)}"
          + (f" / {total} deklarowanych przez API" if total else ""))
    if total and len(wg_id) < total:
        print(f"  UWAGA: brakuje {total - len(wg_id)} kont — dokoncz pobieranie "
              f"(node scripts/pobierz-api.js) i uruchom mnie ponownie")
    return list(wg_id.values())


def main(argv: list[str]) -> int:
    katalog = Path(argv[1]) if len(argv) > 1 else Path("raw")
    wyjscie = Path(argv[2]) if len(argv) > 2 else Path("klienci.csv")

    surowe = wczytaj(katalog)
    usuniete = [r for r in surowe if konto_usuniete(r)]
    if usuniete:
        print(f"  pomijam {len(usuniete)} kont skasowanych (zaslepki 'Uzytkownik usuniety')")
    konta = [rekord_na_wiersz(r) for r in surowe if not konto_usuniete(r)]

    rozjazd = [k for k in konta if k["_zgoda_html"] and k["_zgoda_html"] != k["zgoda_marketing"]]
    if rozjazd:
        print(f"  UWAGA: {len(rozjazd)} kont ma inna zgode w polu JSON niz w tresci karty "
              f"(np. id {rozjazd[0]['_id']}) — sprawdz recznie")
    bez_zgody_w_html = sum(1 for k in konta if not k["_zgoda_html"])
    if bez_zgody_w_html:
        print(f"  (w {bez_zgody_w_html} kartach nie bylo zdania o zgodzie — zostaje wartosc z JSON-a)")
    for k in konta:
        k.pop("_zgoda_html"), k.pop("_id")

    grupy = znajdz_grupy(konta)
    osoby = sorted(
        (scal_grupe(g) for g in grupy),
        key=lambda w: int(w["rezerwacje_u_mnie"]) if w["rezerwacje_u_mnie"].isdigit() else 0,
        reverse=True)

    with wyjscie.open("w", encoding="utf-8-sig", newline="") as f:
        pisarz = csv.DictWriter(f, fieldnames=KOLUMNY, delimiter=SEPARATOR)
        pisarz.writeheader()
        pisarz.writerows(osoby)

    sklejone = sum(1 for g in grupy if len(g) > 1)
    print(f"Zapisano {wyjscie}")
    print(f"  kont: {len(konta)}")
    print(f"  OSOB po scaleniu: {len(osoby)}   (scalono konta w {sklejone} osobach)")
    print(f"  ze zgoda marketingowa: {sum(1 for w in osoby if w['zgoda_marketing'] == 'TAK')}")
    print(f"  z numerem telefonu: {sum(1 for w in osoby if w['telefon'])}")
    print(f"  z prawdziwym mailem (nie alias): {sum(1 for w in osoby if w['email_to_alias'] == 'NIE')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
