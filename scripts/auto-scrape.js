/* ------------------------------------------------------------------
 * auto-scrape.js  —  przechodzi WSZYSTKIE strony sam
 *
 * Panel Zjedz.my stoi na jQuery DataTables (stopka "Pozycje od 1 do 10
 * z 6 965 lacznie", przelacznik "Pokaz X pozycji", strony 1..697).
 * Ten skrypt przestawia liste na 100 pozycji na strone i sam przeklikuje
 * ~70 stron, zbierajac dane po drodze. Nic nie przewijasz recznie.
 *
 * JAK UZYC
 *   1. Wejdz na zakladke "Baza klientow".
 *   2. F12 -> Console -> wklej NAJPIERW caly scrape-dom.js, Enter.
 *   3. Potem wklej caly ten plik, Enter.
 *   4. Poczekaj. Konsola raportuje postep po kazdej stronie.
 *      Na koncu sam zapisze klienci.csv.
 *
 * Przerwanie w trakcie:  zmStop()   (zebrane dane zostaja, zmPobierz() dziala)
 * ------------------------------------------------------------------ */

(async () => {
  const POZYCJI_NA_STRONE = 100;   // przelacznik "Pokaz X pozycji"
  const PAUZA_MS = 600;            // odstep miedzy stronami — nie mlocimy serwera
  const LIMIT_STRON = 1000;        // bezpiecznik przed nieskonczona petla

  if (typeof window.zmZbierz !== 'function') {
    console.error('%c[auto] Najpierw wklej scrape-dom.js, potem ten plik.', 'color:#f66;font-weight:bold');
    return;
  }
  if (window.__zmAuto) {
    console.warn('[auto] juz chodzi — zmStop() zeby przerwac');
    return;
  }
  window.__zmAuto = { stop: false };
  window.zmStop = () => { window.__zmAuto.stop = true; console.warn('[auto] zatrzymuje po biezacej stronie'); };

  const pauza = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = window.jQuery || window.$;

  /* --- 1. dosiegnij API DataTables ------------------------------- */

  function znajdzDT() {
    if (!$ || !$.fn || !$.fn.dataTable) return null;
    try {
      const api = $.fn.dataTable.tables({ visible: true, api: true });
      if (!api || !api.tables || api.tables().count() === 0) return null;
      // gdyby tabel bylo kilka, bierzemy te z najwieksza liczba rekordow
      let najlepsza = null, max = -1;
      api.tables().every(function () {
        const n = this.page.info().recordsTotal;
        if (n > max) { max = n; najlepsza = this; }
      });
      return najlepsza;
    } catch (e) {
      console.warn('[auto] DataTables API niedostepne:', e.message);
      return null;
    }
  }

  const dt = znajdzDT();

  /* --- 2. tryb zapasowy: klikanie w "Nastepna" -------------------- */

  const szukajEl = (wzor, tagi = 'a,button,li,span') =>
    Array.from(document.querySelectorAll(tagi))
      .find((el) => wzor.test((el.textContent || '').trim()));

  const przyciskNastepna = () => szukajEl(/^(Nast[eę]pna|Next)$/i);

  const wylaczony = (el) => {
    if (!el) return true;
    const kandydat = el.closest('li,.paginate_button') || el;
    return /disabled/.test(kandydat.className || '') ||
           kandydat.getAttribute('aria-disabled') === 'true';
  };

  // "Pozycje od 1 do 10 z 6 965 lacznie" -> 6965
  function ileLacznie() {
    const el = Array.from(document.querySelectorAll('div,p,span'))
      .reverse()
      .find((e) => /Pozycje od[\s\S]*?[lł][aą]cznie/i.test(e.textContent || ''));
    if (!el) return null;
    const m = (el.textContent || '').match(/z\s*([\d\s  ]+?)\s*[lł][aą]cznie/i);
    return m ? parseInt(m[1].replace(/[\s ]/g, ''), 10) : null;
  }

  /* --- 3. przestaw na 100 pozycji na strone ----------------------- */

  async function ustawDlugosc() {
    if (dt) {
      dt.page.len(POZYCJI_NA_STRONE).draw(false);
      await czekajNaDraw();
      return true;
    }
    // bez jQuery: znajdz <select> obok napisu "Pokaz ... pozycji"
    const select = Array.from(document.querySelectorAll('select'))
      .find((s) => /pozycji|entries/i.test(s.parentElement?.textContent || ''));
    if (!select) return false;
    const opcje = Array.from(select.options).map((o) => parseInt(o.value, 10)).filter((n) => n > 0);
    const cel = opcje.filter((n) => n <= POZYCJI_NA_STRONE).sort((a, b) => b - a)[0];
    if (!cel) return false;
    select.value = String(cel);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await pauza(1500);
    return true;
  }

  function czekajNaDraw() {
    return new Promise((res) => {
      let gotowe = false;
      const koniec = () => { if (!gotowe) { gotowe = true; res(); } };
      dt.one('draw', koniec);
      setTimeout(koniec, 15000);            // nie wiesz sie, gdy draw nie przyjdzie
    });
  }

  /* --- 4. czekanie na faktyczna zmiane tresci --------------------- */

  // Podpis biezacej strony — pierwszy i ostatni mail w widocznej tabeli.
  // Sluzy do wykrycia, ze nowa strona naprawde sie dorenderowala.
  function podpisStrony() {
    const maile = (document.body.innerText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []);
    return maile.length ? `${maile[0]}..${maile[maile.length - 1]}|${maile.length}` : '';
  }

  async function czekajNaZmiane(poprzedni, maxMs = 15000) {
    const doKiedy = Date.now() + maxMs;
    while (Date.now() < doKiedy) {
      await pauza(250);
      if (podpisStrony() !== poprzedni) { await pauza(250); return true; }
    }
    return false;
  }

  /* --- 5. glowna petla ------------------------------------------- */

  console.log('%c[auto] start — ustawiam 100 pozycji na strone…', 'color:#fc0;font-weight:bold');
  const udaloSieDlugosc = await ustawDlugosc();
  if (!udaloSieDlugosc) {
    console.warn('[auto] nie znalazlem przelacznika liczby pozycji — jade z obecnym ustawieniem');
  }
  await pauza(PAUZA_MS);

  const lacznie = ileLacznie();
  const stronLacznie = dt ? dt.page.info().pages : null;
  console.log(
    `%c[auto] rekordow w bazie: ${lacznie ?? '?'} | stron do przejscia: ${stronLacznie ?? '?'}`,
    'color:#9f6;font-weight:bold'
  );

  const start = Date.now();
  let strona = 0;

  while (strona < LIMIT_STRON) {
    strona++;
    window.zmZbierz();

    if (window.__zmAuto.stop) { console.warn('[auto] przerwane przez uzytkownika'); break; }

    const stan = window.zmIle();
    const ile = stronLacznie ? `${strona}/${stronLacznie}` : `${strona}`;
    const proc = lacznie ? ` (${Math.round((stan.konta / lacznie) * 100)}%)` : '';
    console.log(`%c[auto] strona ${ile} — kont: ${stan.konta}${proc}, osob: ${stan.osoby}`, 'color:#6cf');

    // --- przejdz dalej ---
    const podpis = podpisStrony();
    let poszlo = false;

    if (dt) {
      const info = dt.page.info();
      if (info.page + 1 >= info.pages) break;         // to byla ostatnia strona
      dt.page('next').draw(false);
      await czekajNaDraw();
      poszlo = true;
    } else {
      const btn = przyciskNastepna();
      if (!btn || wylaczony(btn)) break;
      btn.click();
      poszlo = await czekajNaZmiane(podpis);
      if (!poszlo) { console.warn('[auto] strona sie nie zmienila — koncze'); break; }
    }

    await pauza(PAUZA_MS);
  }

  /* --- 6. podsumowanie i zapis ------------------------------------ */

  const stan = window.zmIle();
  const sekundy = Math.round((Date.now() - start) / 1000);
  console.log(
    `%c[auto] koniec po ${strona} stronach w ${sekundy}s — kont: ${stan.konta}, OSOB: ${stan.osoby}`,
    'color:#9f6;font-weight:bold;font-size:14px'
  );

  if (lacznie && stan.konta < lacznie) {
    console.warn(
      `[auto] UWAGA: zebrano ${stan.konta} z ${lacznie} rekordow. ` +
      'Brakujace strony mogly sie nie doladowac — odpal ten skrypt jeszcze raz, ' +
      'dozbiera brakujace (duplikaty odpadaja same).'
    );
  }

  window.__zmAuto = null;
  window.zmPobierz();
})();
