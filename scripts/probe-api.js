/* ------------------------------------------------------------------
 * probe-api.js  —  KROK 1 (opcjonalny, ale warto)
 *
 * Podsluchuje zapytania sieciowe strony i wypisuje te, ktore wygladaja
 * na API zwracajace liste klientow. Jesli takie znajdziemy, da sie
 * pobrac czyste JSON-y zamiast scrapowac HTML — szybciej i pewniej.
 *
 * JAK UZYC
 *   1. Wejdz na https://zjedz.my/tygryz-restauracja-poznan/profile#company-users
 *   2. F12 -> zakladka "Console"
 *   3. Wklej CALY ten plik, Enter
 *   4. Odswiez liste (przeladuj strone / kliknij nastepna strone / przewin)
 *   5. Skopiuj to, co wypisze konsola, i wklej mi
 * ------------------------------------------------------------------ */

(() => {
  if (window.__zmProbe) {
    console.warn('[probe] juz uruchomiony — pomijam');
    return;
  }
  window.__zmProbe = { hits: [] };

  const INTERESUJACE = /user|client|klient|customer|guest|contact|reservation|rezerwacj|company/i;

  const zapisz = (metoda, url, status, probka) => {
    if (!INTERESUJACE.test(url)) return;
    window.__zmProbe.hits.push({ metoda, url, status });
    console.log(
      `%c[probe] ${metoda} ${status}%c ${url}`,
      'color:#9f6;font-weight:bold', 'color:inherit'
    );
    if (probka) console.log('        probka odpowiedzi:', probka.slice(0, 600));
  };

  // --- przechwytujemy fetch() ---
  const oryginalnyFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    const metoda = args[1]?.method ?? (typeof args[0] === 'object' ? args[0]?.method : null) ?? 'GET';
    const odp = await oryginalnyFetch.apply(this, args);
    try {
      const tekst = await odp.clone().text();
      zapisz(metoda, url, odp.status, tekst);
    } catch { zapisz(metoda, url, odp.status, null); }
    return odp;
  };

  // --- przechwytujemy XMLHttpRequest ---
  const oryginalnyOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metoda, url, ...reszta) {
    this.addEventListener('load', () => {
      let probka = null;
      try { probka = String(this.responseText); } catch { /* responseType != text */ }
      zapisz(metoda, url, this.status, probka);
    });
    return oryginalnyOpen.call(this, metoda, url, ...reszta);
  };

  console.log(
    '%c[probe] gotowe.%c Teraz odswiez liste klientow / kliknij nastepna strone.\n' +
    'Podsumowanie w kazdej chwili: copy(JSON.stringify(window.__zmProbe.hits, null, 2))',
    'color:#9f6;font-weight:bold', 'color:inherit'
  );
})();
