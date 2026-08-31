/* ------------------------------------------------------------------
 * api-scrape.js  —  NAJSZYBSZA DROGA: prosto z API panelu
 *
 * Panel "Baza klientow" stoi na server-side DataTables, ktory ma wlasny
 * endpoint JSON:
 *
 *   GET /<restauracja>/profile/ajax/datatables/users?draw=1&start=0&length=500
 *
 * Odpowiedz zawiera recordsTotal (u nas 6965) i tablice data[] — a w niej
 * komplet pol klienta plus added_details: gotowy HTML karty. Zamiast
 * przeklikiwac 70 stron pobieramy wszystko petla po ~14 zapytaniach.
 * Zadnych hasel — leci Twoja wlasna, zalogowana sesja (ciasteczko).
 *
 * JAK UZYC
 *   1. Wejdz na zakladke "Baza klientow".
 *   2. F12 -> Console -> wklej NAJPIERW caly scrape-dom.js, Enter.
 *   3. Potem wklej caly ten plik, Enter.
 *   4. Poczekaj (~10 min). Na koncu sam zapisze klienci.csv.
 *
 * Przerwanie w trakcie:  zmStop()   (zebrane dane zostaja, zmPobierz() dziala)
 *
 * Gdyby endpoint kiedys zniknal — wroc do auto-scrape.js, ktory klika po DOM.
 * ------------------------------------------------------------------ */

(async () => {
  const PORCJA = 500;      // rekordow na zadanie; 500 = ~45 s i ~6,6 MB odpowiedzi
  const PAUZA_MS = 2000;   // odstep miedzy porcjami — nie mlocimy serwera
  const STATUS = /(Zrealizowana|Potwierdzona|Anulowana|Oczekuj[aą]ca|Niezrealizowana|Nowa|Odrzucona|Odwo[lł]ana(?: przez (?:klienta|restauracj[eę]))?)/;

  if (typeof window.zmParsuj !== 'function' || typeof window.zmDataPL !== 'function') {
    console.error('%c[api] Najpierw wklej scrape-dom.js, potem ten plik.', 'color:#f66;font-weight:bold');
    return;
  }
  if (window.__zmAuto) { console.warn('[api] cos juz chodzi — zmStop() zeby przerwac'); return; }
  window.__zmAuto = { stop: false };
  window.zmStop = () => { window.__zmAuto.stop = true; console.warn('[api] zatrzymuje po biezacej porcji'); };

  // scrape-dom.js przy wklejeniu zbiera karty widoczne na ekranie i kluczuje je
  // mailem+telefonem, my kluczujemy id z API — te same konta trafilyby do
  // magazynu dwa razy i rezerwacje policzylyby sie podwojnie. Zaczynamy czysto:
  const magazyn = window.__zm.wiersze;
  if (magazyn.size) console.log(`[api] czyszcze magazyn (${magazyn.size} kont ze zbierania po DOM)`);
  magazyn.clear();
  const pauza = (ms) => new Promise((r) => setTimeout(r, ms));

  // /tygryz-restauracja-poznan/profile -> /tygryz-restauracja-poznan/profile/ajax/datatables/users
  const restauracja = location.pathname.split('/').filter(Boolean)[0];
  const ENDPOINT = `${location.origin}/${restauracja}/profile/ajax/datatables/users`;

  // Sortowanie po id. Domyslne (bez parametrow) daje ten sam wynik, ale jawne
  // jest odporne na zmiane ustawien tabeli — przy stronicowaniu kolejnosc MUSI
  // byc stabilna, inaczej czesc rekordow wypadnie miedzy porcjami.
  const SORT = 'columns[0][data]=id&columns[0][name]=id&columns[0][searchable]=false'
             + '&columns[0][orderable]=true&order[0][column]=0&order[0][dir]=asc';

  /* --- karta HTML -> wiersz --------------------------------------- */

  // parsujKarte() czyta innerText, a ten dziala tylko na elemencie faktycznie
  // renderowanym — trzymamy wiec kontener poza ekranem, zamiast display:none.
  const kontener = document.createElement('div');
  kontener.style.cssText = 'position:absolute;left:-99999px;top:0;width:1200px';
  document.body.appendChild(kontener);

  // Kafelki w "Ostatnie rezerwacje" NIE sa ulozone chronologicznie, wiec
  // przegladamy wszystkie i bierzemy najpozniejsza date (ISO sortuje sie tekstowo).
  function najnowszaRezerwacja(el) {
    let najlepsza = null;
    for (const kafelek of el.querySelectorAll('a[href*="/c/"]')) {
      const t = kafelek.innerText || '';
      const data = window.zmDataPL(t);
      if (!data) continue;
      if (!najlepsza || data > najlepsza.ostatnia_rezerwacja_data) {
        najlepsza = {
          ostatnia_rezerwacja_data: data,
          ostatnia_rezerwacja_status: (t.match(STATUS) || [''])[0].trim(),
          ostatnia_rezerwacja_osob: (t.match(/(\d+)\s*os\./) || ['', ''])[1],
        };
      }
    }
    return najlepsza || {};
  }

  // Konta skasowane (RODO) panel oddaje z zaslepkami: nick "Uzytkownik usuniety",
  // mail w domenie @zjedz.my, telefon +48123456789. Wspolna zaslepka telefonu
  // sklejalaby je scalaniem w jedna fikcyjna osobe — i tak nie sa kontaktem
  // do kampanii, wiec wypadaja tutaj.
  const kontoUsuniete = (r) => /@zjedz\.my$/i.test(r.email || '')
                            || /usuni/i.test(r.first_name || '');
  let usuniete = 0;

  function naWiersz(r) {
    kontener.innerHTML = r.added_details || '';
    const wiersz = window.zmParsuj(kontener.innerText || '') || {};
    const nick = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();

    // Pola, ktore API podaje wprost, bija to co wyskrobane z HTML-a.
    Object.assign(wiersz, najnowszaRezerwacja(kontener), {
      nick: nick || wiersz.nick || String(r.email || '').split('@')[0],
      email: r.email || wiersz.email || '',
      telefon: (r.phone || '').replace(/[^\d+]/g, '') || wiersz.telefon || '',
      dolaczyl: String(r.created_at || '').slice(0, 10) || wiersz.dolaczyl,
      zgoda_marketing: r.mailing_external ? 'TAK' : 'NIE',
      rezerwacje_u_mnie: Number.isInteger(r.reservations_count) ? String(r.reservations_count)
                                                                : wiersz.rezerwacje_u_mnie,
    });
    wiersz.__id = String(r.id);        // id z API jest pewniejszym kluczem niz mail+telefon
    return wiersz;
  }

  /* --- petla po porcjach ------------------------------------------ */

  const pobierzPorcje = async (start) => {
    const res = await fetch(`${ENDPOINT}?draw=1&start=${start}&length=${PORCJA}&${SORT}`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  console.log('%c[api] endpoint: ' + ENDPOINT, 'color:#9f6');
  let start = 0, total = null;
  try {
    while (total === null || start < total) {
      if (window.__zmAuto.stop) { console.warn('[api] przerwane przez zmStop()'); break; }

      let j = null;
      for (let proba = 1; proba <= 3 && !j; proba++) {
        try { j = await pobierzPorcje(start); }
        catch (e) {
          console.warn(`[api] porcja ${start}, proba ${proba} nieudana: ${e.message}`);
          await pauza(5000 * proba);
        }
      }
      if (!j) throw new Error(`porcja ${start} nie przeszla po 3 probach`);

      total = j.recordsTotal;
      for (const r of j.data || []) {
        if (kontoUsuniete(r)) { usuniete++; continue; }
        magazyn.set(String(r.id), naWiersz(r));
      }

      const osoby = window.zmScal().length;
      console.log(`%c[api] ${Math.min(start + PORCJA, total)}/${total} kont | OSOB: ${osoby}`,
                  'color:#9f6;font-weight:bold');
      start += PORCJA;
      await pauza(PAUZA_MS);
    }
  } catch (e) {
    console.error('[api] przerwane:', e.message,
                  '— zebrane dane zostaja, zmPobierz() dziala, ponowne uruchomienie dozbiera reszte');
  } finally {
    kontener.remove();
    window.__zmAuto = null;
  }

  console.log(`%c[api] koniec: ${magazyn.size} kont${total ? ' z ' + total : ''}`
              + (usuniete ? ` (pominieto ${usuniete} kont skasowanych)` : ''),
              'color:#fc0;font-weight:bold');
  if (total && magazyn.size < total) {
    console.warn(`[api] brakuje ${total - magazyn.size} kont — odpal ten plik jeszcze raz`);
  }
  window.zmPobierz();
})();
