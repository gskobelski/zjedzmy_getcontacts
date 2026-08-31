/* ------------------------------------------------------------------
 * scrape-dom.js  —  KROK 2 (glowne narzedzie)
 *
 * Czyta karty klientow prosto z DOM-u strony, na ktorej JESTES ZALOGOWANY.
 * Zbiera dane do pamieci (window.__zm), odporne na duplikaty, wiec mozesz
 * przechodzic strona po stronie i odpalac go wielokrotnie.
 *
 * JAK UZYC
 *   1. Wejdz na liste klientow, przewin ja do samego dolu (jesli doladowuje
 *      sie w trakcie przewijania — musi byc widoczna cala).
 *   2. F12 -> "Console" -> wklej CALY ten plik -> Enter
 *   3. Konsola wypisze ile kart zlapala. Kliknij nastepna strone i wpisz:
 *          zmZbierz()
 *      Powtarzaj dla kazdej strony.
 *   4. Na koniec:
 *          zmPobierz()        // zapisuje klienci.csv na dysk
 *          zmPobierzJSON()    // to samo w JSON (jesli wolisz)
 *
 * Konta tej samej osoby (ten sam mail LUB ten sam telefon) sa scalane
 * w jeden wiersz przy eksporcie — patrz sekcja "scalanie tozsamosci".
 *
 * Pomocnicze:
 *   zmIle()        — ile kont i ile osob po scaleniu
 *   zmPodglad()    — tabelka w konsoli
 *   zmDuplikaty()  — pokazuje, ktore konta zostaly polaczone
 *   zmReset()      — czysci pamiec i zaczyna od nowa
 * ------------------------------------------------------------------ */

(() => {
  // W polskim Excelu separatorem jest srednik. Jesli importujesz do
  // narzedzia mailingowego, ktore wymaga przecinka — zmien na ','.
  const SEPARATOR = ';';

  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const TELEFON = /(\+?\d[\d\s -]{7,}\d)/;

  // Gdy jedno konto ma zgode, a drugie nie: false = wygrywa ZGODA (raz udzielona
  // liczy sie dla calej osoby). Ustaw true, jesli ma wygrywac brak zgody.
  const ZGODA_OPTOUT_WYGRYWA = false;

  // adresy-przekierowania: Apple, Firefox Relay, DuckDuckGo, SimpleLogin, AnonAddy
  const ALIAS_MAILA = /@(privaterelay\.appleid\.com|relay\.firefox\.com|duck\.com|simplelogin\.|anonaddy\.)/i;

  const MIESIACE = {
    stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6,
    lipca: 7, sierpnia: 8, wrzesnia: 9, pazdziernika: 10, listopada: 11, grudnia: 12,
  };

  const magazyn = (window.__zm ||= { wiersze: new Map() });

  /* --- pomocnicze ------------------------------------------------- */

  const bezOgonkow = (s) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');

  const czysty = (s) => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();

  // wycina fragment tekstu miedzy dwoma znacznikami
  const wytnij = (tekst, od, doZnacznika) => {
    const start = od ? tekst.search(od) : 0;
    if (start < 0) return '';
    const reszta = tekst.slice(start);
    if (!doZnacznika) return reszta;
    const koniec = reszta.slice(1).search(doZnacznika);
    return koniec < 0 ? reszta : reszta.slice(0, koniec + 1);
  };

  const dopasuj = (tekst, wzor, grupa = 1) => {
    const m = tekst.match(wzor);
    return m ? czysty(m[grupa]) : '';
  };

  const telefonNorm = (surowy) => {
    const cyfry = (surowy || '').replace(/[^\d+]/g, '');
    if (!cyfry) return '';
    if (cyfry.startsWith('+')) return cyfry;
    if (cyfry.length === 9) return '+48' + cyfry;          // polski numer bez kierunkowego
    if (cyfry.length === 11 && cyfry.startsWith('48')) return '+' + cyfry;
    return cyfry;
  };

  // "niedziela, 29 marca 2026 20:15" -> "2026-03-29 20:15"
  const dataPL = (surowa) => {
    const m = bezOgonkow(surowa || '').match(/(\d{1,2}) ([a-z]+) (\d{4})(?: (\d{1,2}:\d{2}))?/i);
    if (!m) return '';
    const mies = MIESIACE[m[2].toLowerCase()];
    if (!mies) return '';
    const iso = `${m[3]}-${String(mies).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return m[4] ? `${iso} ${m[4]}` : iso;
  };

  /* --- parsowanie jednej karty ------------------------------------ */

  function parsujKarte(surowyTekst) {
    const tekst = czysty(surowyTekst.replace(/ /g, ' '));
    const email = (tekst.match(EMAIL) || [''])[0];
    if (!email) return null;

    // Strona dzieli statystyki na dwie kolumny — rozdzielamy je,
    // bo obie uzywaja tych samych etykiet ("Ulubiona godzina" itd.).
    const granica = tekst.search(/Aktywno[sś][cć] w Twojej/);
    const glowa = granica < 0 ? tekst : tekst.slice(0, granica);
    const wRestauracji = wytnij(tekst, /Aktywno[sś][cć] w Twojej/, /w Zjedz\.my/);
    const wZjedzmy = wytnij(tekst, /w Zjedz\.my/, /Ostatnie rezerwacje|Opinia/);
    const ostatnie = wytnij(tekst, /Ostatnie rezerwacje/, null);

    // Nick to pierwsza niepusta linia karty (nad adresem e-mail).
    const nick = czysty((surowyTekst.split('\n').map(czysty).filter(Boolean)[0] || ''))
      .replace(EMAIL, '').trim() || email.split('@')[0];

    const zgoda = /Brak zgody na przesy/i.test(glowa) ? 'NIE'
      : /Zgoda na przesy/i.test(glowa) ? 'TAK'
      : '';

    // "Nowy Klient" = pierwsza wizyta; inaczej strona podaje licznik.
    const nowy = /Nowy Klient/i.test(wRestauracji);
    const rezWRestauracji = nowy ? '1' : (dopasuj(wRestauracji, /Rezerwacje:\s*(\d+)/) || '');

    return {
      nick,
      email,
      // data "2026-02-13" tez pasuje do wzorca telefonu — usuwamy ja najpierw
      telefon: telefonNorm(dopasuj(glowa.replace(/\d{4}-\d{2}-\d{2}/g, ' '), TELEFON)),
      dolaczyl: dopasuj(glowa, /Do[lł][aą]czy[lł]:\s*(\d{4}-\d{2}-\d{2})/),
      zgoda_marketing: zgoda,
      nowy_klient: nowy ? 'TAK' : 'NIE',
      rezerwacje_u_mnie: rezWRestauracji,
      rezerwacje_zjedzmy: dopasuj(wZjedzmy, /Rezerwacje:\s*(\d+)/),
      // Panel podaje "Zazwyczaj przychodzi z" osobno dla Twojej restauracji i dla
      // calego Zjedz.my, przy czym na 500 kart 128 mialo to TYLKO w kolumnie
      // Zjedz.my. Wolimy liczbe z Twojego lokalu, globalna to plan B.
      zwykle_osob: dopasuj(wRestauracji, /Zazwyczaj przychodzi z\s*(\d+)/)
                   || dopasuj(wZjedzmy, /Zazwyczaj przychodzi z\s*(\d+)/),
      ulubiona_godzina: dopasuj(wRestauracji, /Ulubiona godzina:\s*(\d+)/),
      ulubiony_dzien: dopasuj(wRestauracji, /Ulubiony dzie[nń]:\s*(\p{L}+)/u),
      ostatnia_rezerwacja_data: dataPL(ostatnie),
      ostatnia_rezerwacja_status: dopasuj(ostatnie, /(Zrealizowana|Potwierdzona|Anulowana|Odwo[lł]ana|Oczekuj[aą]ca|Niezrealizowana)/i),
      ostatnia_rezerwacja_osob: dopasuj(ostatnie, /(\d+)\s*os\./),
    };
  }

  /* --- znajdowanie kart na stronie -------------------------------- */

  function znajdzKarty() {
    const wszystkie = Array.from(document.querySelectorAll('div, section, article, li'));

    // Najmniejsze elementy zawierajace jednoczesnie e-mail i date dolaczenia
    // = naglowek karty klienta.
    const naglowki = wszystkie.filter((el) => {
      const t = el.innerText || '';
      return /Do[lł][aą]czy[lł]:/.test(t) && EMAIL.test(t);
    });
    const wewnetrzne = naglowki.filter((el) => !naglowki.some((inny) => inny !== el && el.contains(inny)));

    // Statystyki ("Rezerwacje", "Ulubiony dzien") leza w sasiednim boksie,
    // wiec wspinamy sie w gore drzewa — ale zatrzymujemy sie, zanim
    // zagarniemy kolejnego klienta.
    return wewnetrzne.map((el) => {
      let biezacy = el;
      for (let i = 0; i < 10 && biezacy.parentElement; i++) {
        const rodzic = biezacy.parentElement;
        const ileMaili = (rodzic.innerText.match(new RegExp(EMAIL.source, 'g')) || []).length;
        if (ileMaili > 1) break;                 // rodzic obejmuje juz kilka kart
        biezacy = rodzic;
        if (/Ostatnie rezerwacje/.test(biezacy.innerText)) break;
      }
      return biezacy;
    });
  }

  /* --- scalanie tozsamosci ----------------------------------------- */

  /* Ten sam czlowiek potrafi miec kilka kont: raz zaloguje sie przez Apple
   * (alias @privaterelay), raz zwyklym mailem. Numer telefonu zwykle zostaje
   * ten sam. Laczymy wiec konta przechodnio: A i B po mailu, B i C po
   * telefonie => A, B i C to jedna osoba.
   *
   * UWAGA: puste pola nigdy nie lacza. Inaczej wszyscy bez telefonu
   * skleiliby sie w jednego klienta. */

  function znajdzGrupy(rekordy) {
    const rodzic = new Map();                          // klucz -> reprezentant
    const znajdz = (k) => {
      while (rodzic.get(k) !== k) { rodzic.set(k, rodzic.get(rodzic.get(k))); k = rodzic.get(k); }
      return k;
    };
    const polacz = (a, b) => { const ra = znajdz(a), rb = znajdz(b); if (ra !== rb) rodzic.set(ra, rb); };
    const dodaj = (k) => { if (!rodzic.has(k)) rodzic.set(k, k); };

    for (const r of rekordy) {
      const klucze = [];
      if (r.email) klucze.push('e:' + r.email.toLowerCase());
      if (r.telefon) klucze.push('t:' + r.telefon);
      if (!klucze.length) klucze.push('x:' + r.__id);  // brak maila i telefonu = osobna osoba
      klucze.forEach(dodaj);
      for (let i = 1; i < klucze.length; i++) polacz(klucze[0], klucze[i]);
    }

    const grupy = new Map();
    for (const r of rekordy) {
      const pierwszyKlucz = r.email ? 'e:' + r.email.toLowerCase()
        : r.telefon ? 't:' + r.telefon
        : 'x:' + r.__id;
      const korzen = znajdz(pierwszyKlucz);
      if (!grupy.has(korzen)) grupy.set(korzen, []);
      grupy.get(korzen).push(r);
    }
    return Array.from(grupy.values());
  }

  const sumaInt = (rekordy, pole) => {
    const liczby = rekordy.map((r) => parseInt(r[pole], 10)).filter((n) => !isNaN(n));
    return liczby.length ? String(liczby.reduce((a, b) => a + b, 0)) : '';
  };

  const pierwszeNiepuste = (rekordy, pole) => (rekordy.find((r) => r[pole]) || {})[pole] || '';

  function scalGrupe(grupa) {
    const emaile = [...new Set(grupa.map((r) => r.email).filter(Boolean))];
    const telefony = [...new Set(grupa.map((r) => r.telefon).filter(Boolean))];

    // do kampanii wolimy prawdziwy adres niz alias przekierowujacy
    const zwykle = emaile.filter((e) => !ALIAS_MAILA.test(e));
    const email = zwykle[0] || emaile[0] || '';

    // preferencje bierzemy z konta o najwiekszej liczbie rezerwacji — ma najwiecej danych
    const wgAktywnosci = [...grupa].sort(
      (a, b) => (parseInt(b.rezerwacje_u_mnie, 10) || 0) - (parseInt(a.rezerwacje_u_mnie, 10) || 0)
    );
    // "ostatnia rezerwacja" to najpozniejsza ze wszystkich kont (daty sa ISO, wiec sortuja sie tekstowo)
    const najnowsze = [...grupa]
      .filter((r) => r.ostatnia_rezerwacja_data)
      .sort((a, b) => b.ostatnia_rezerwacja_data.localeCompare(a.ostatnia_rezerwacja_data))[0] || {};

    const zgody = grupa.map((r) => r.zgoda_marketing).filter(Boolean);
    const zgoda = ZGODA_OPTOUT_WYGRYWA
      ? (zgody.includes('NIE') ? 'NIE' : zgody.includes('TAK') ? 'TAK' : '')
      : (zgody.includes('TAK') ? 'TAK' : zgody.includes('NIE') ? 'NIE' : '');

    const daty = grupa.map((r) => r.dolaczyl).filter(Boolean).sort();
    const rezerwacjeUMnie = sumaInt(grupa, 'rezerwacje_u_mnie');

    return {
      nick: pierwszeNiepuste(wgAktywnosci, 'nick'),
      email,
      email_to_alias: email && ALIAS_MAILA.test(email) ? 'TAK' : 'NIE',
      telefon: telefony[0] || '',
      dolaczyl: daty[0] || '',                         // najwczesniejsza data zalozenia konta
      zgoda_marketing: zgoda,
      nowy_klient: (parseInt(rezerwacjeUMnie, 10) || 0) > 1 ? 'NIE' : 'TAK',
      rezerwacje_u_mnie: rezerwacjeUMnie,
      rezerwacje_zjedzmy: sumaInt(grupa, 'rezerwacje_zjedzmy'),
      zwykle_osob: pierwszeNiepuste(wgAktywnosci, 'zwykle_osob'),
      ulubiona_godzina: pierwszeNiepuste(wgAktywnosci, 'ulubiona_godzina'),
      ulubiony_dzien: pierwszeNiepuste(wgAktywnosci, 'ulubiony_dzien'),
      ostatnia_rezerwacja_data: najnowsze.ostatnia_rezerwacja_data || '',
      ostatnia_rezerwacja_status: najnowsze.ostatnia_rezerwacja_status || '',
      ostatnia_rezerwacja_osob: najnowsze.ostatnia_rezerwacja_osob || '',
      liczba_kont: String(grupa.length),
      emaile_wszystkie: emaile.join(' | '),
      telefony_wszystkie: telefony.join(' | '),
    };
  }

  const scal = () =>
    znajdzGrupy(Array.from(magazyn.wiersze.values()))
      .map(scalGrupe)
      .sort((a, b) => (parseInt(b.rezerwacje_u_mnie, 10) || 0) - (parseInt(a.rezerwacje_u_mnie, 10) || 0));

  /* --- API w konsoli ---------------------------------------------- */

  window.zmZbierz = function () {
    const karty = znajdzKarty();
    let nowe = 0, pominiete = 0;
    for (const karta of karty) {
      const wiersz = parsujKarte(karta.innerText || '');
      if (!wiersz) { pominiete++; continue; }
      // klucz surowy = mail+telefon, zeby dwukrotne zebranie tej samej karty
      // nie liczylo sie podwojnie. Scalanie osob dzieje sie dopiero przy eksporcie.
      const klucz = `${wiersz.email}|${wiersz.telefon}`;
      wiersz.__id = klucz;
      if (!magazyn.wiersze.has(klucz)) nowe++;
      magazyn.wiersze.set(klucz, wiersz);
    }
    const osoby = scal().length;
    console.log(
      `%c[zjedzmy] karty na stronie: ${karty.length} | nowe: ${nowe} | ` +
      `nieprzeczytane: ${pominiete} | kont: ${magazyn.wiersze.size} | OSOB: ${osoby}`,
      'color:#9f6;font-weight:bold'
    );
    if (karty.length === 0) {
      console.warn('[zjedzmy] nie znalazlem zadnej karty — czy na pewno jestes na zakladce "Baza klientow"?');
    }
    return osoby;
  };

  window.zmIle = () => ({ konta: magazyn.wiersze.size, osoby: scal().length });
  window.zmParsuj = parsujKarte;                    // przydatne do debugowania jednej karty
  window.zmDataPL = dataPL;                         // uzywa tego api-scrape.js
  window.zmScal = scal;                             // gotowe wiersze przed zapisem do pliku
  window.zmPodglad = () => console.table(scal().slice(0, 25));
  window.zmReset = () => { magazyn.wiersze.clear(); console.log('[zjedzmy] pamiec wyczyszczona'); };

  // pokazuje, ktore konta zostaly ze soba polaczone i dlaczego
  window.zmDuplikaty = () => {
    const sklejone = znajdzGrupy(Array.from(magazyn.wiersze.values())).filter((g) => g.length > 1);
    console.log(`%c[zjedzmy] osob z wieloma kontami: ${sklejone.length}`, 'color:#fc0;font-weight:bold');
    sklejone.forEach((g) => console.log(
      '  ' + g.map((r) => `${r.email || '(brak maila)'} / ${r.telefon || '(brak tel.)'}`).join('  +  ')
    ));
    return sklejone;
  };

  function doCSV() {
    const wiersze = scal();
    if (!wiersze.length) return '';
    const kolumny = Object.keys(wiersze[0]);
    const pole = (v) => {
      const s = String(v ?? '');
      return /["\n\r]|[;,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [
      kolumny.join(SEPARATOR),
      ...wiersze.map((w) => kolumny.map((k) => pole(w[k])).join(SEPARATOR)),
    ].join('\r\n');
  }

  function zapisz(nazwa, tresc, typ) {
    // BOM, zeby Excel poprawnie pokazal polskie znaki
    const blob = new Blob(['﻿' + tresc], { type: typ + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nazwa;
    a.click();
    URL.revokeObjectURL(a.href);
    console.log(
      `%c[zjedzmy] zapisano ${nazwa} — ${scal().length} osob z ${magazyn.wiersze.size} kont`,
      'color:#9f6;font-weight:bold');
  }

  window.zmPobierz = () => zapisz('klienci.csv', doCSV(), 'text/csv');
  window.zmPobierzJSON = () =>
    zapisz('klienci.json', JSON.stringify(scal(), null, 2), 'application/json');

  // pierwsze zbieranie od razu przy wklejeniu
  window.zmZbierz();
  console.log(
    '%cKomendy:%c zmZbierz() po kazdej stronie · zmIle() · zmPodglad() · zmDuplikaty() · zmPobierz() · zmPobierzJSON() · zmReset()',
    'color:#fc0;font-weight:bold', 'color:inherit'
  );
})();
