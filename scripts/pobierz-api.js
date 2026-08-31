/* ------------------------------------------------------------------
 * pobierz-api.js  —  caly eksport jednym poleceniem
 *
 *   npm install     (raz — playwright + chromium)
 *   npm start       (albo: node scripts/pobierz-api.js)
 *
 * Otwiera okno przegladarki na panelu Zjedz.my. Jesli nie jestes zalogowany,
 * czeka az zalogujesz sie RECZNIE — skrypt nigdy nie widzi Twojego hasla.
 * Potem sam pobiera cala baze klientow z API panelu i zapisuje klienci.csv
 * obok repo. Zajmuje ok. 10 minut przy ~7000 kontaktow.
 *
 * Inna restauracja niz domyslna:
 *   node scripts/pobierz-api.js nazwa-restauracji-z-adresu
 *
 * Co sie tu dzieje: cala robota (pobieranie, parsowanie kart, scalanie kont,
 * zapis CSV) siedzi w scripts/scrape-dom.js + scripts/api-scrape.js, czyli
 * w tych samych plikach, ktore mozna wkleic recznie do konsoli przegladarki.
 * Ten skrypt tylko otwiera okno, wstrzykuje je i lapie gotowy plik. Dzieki
 * temu obie drogi licza dokladnie to samo — nie ma drugiej implementacji,
 * ktora moglaby sie rozjechac.
 *
 * Przy okazji odklada surowe odpowiedzi API do raw/. Nie sa do niczego
 * potrzebne, ale pozwalaja przeliczyc CSV jeszcze raz bez ruszania serwera:
 *   python3 parsuj_api.py raw/
 * ------------------------------------------------------------------ */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const RESTAURACJA = process.argv[2] || 'tygryz-restauracja-poznan';
const KORZEN = path.resolve(__dirname, '..');
const KATALOG_RAW = path.join(KORZEN, 'raw');
const PROFIL = path.join(KORZEN, '.profil-przegladarki');
const WYJSCIE = path.join(KORZEN, 'klienci.csv');
const PANEL = `https://zjedz.my/${RESTAURACJA}/profile#company-users`;

const MINUTA = 60_000;
const LIMIT_LOGOWANIA = 15 * MINUTA;
const LIMIT_POBIERANIA = 45 * MINUTA;   // ~10 min przy 7 tys. kontaktow, z duzym zapasem

const pauza = (ms) => new Promise((r) => setTimeout(r, ms));
const czytaj = (plik) => fs.readFileSync(path.join(__dirname, plik), 'utf8');

async function czekajNaLogowanie(strona) {
  if (!strona.url().includes('/login')) return true;
  console.log('\n>>> Zaloguj sie w otwartym oknie przegladarki. Czekam...\n');
  for (let i = 0; i < LIMIT_LOGOWANIA / 3000; i++) {
    await pauza(3000);
    if (!strona.url().includes('/login')) {
      console.log('Zalogowano — ruszam.\n');
      await strona.goto(PANEL, { waitUntil: 'domcontentloaded' });
      await pauza(3000);                 // niech zakladka zdazy sie doladowac
      return true;
    }
  }
  console.error('Nie doczekalem sie logowania.');
  return false;
}

(async () => {
  fs.mkdirSync(KATALOG_RAW, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFIL, {
    headless: false, viewport: null, locale: 'pl-PL', timezoneId: 'Europe/Warsaw',
  });
  const strona = ctx.pages()[0] || await ctx.newPage();

  // Surowe odpowiedzi API lapiemy po drodze, zamiast pobierac je drugi raz.
  strona.on('response', async (odp) => {
    if (!odp.url().includes('/ajax/datatables/users') || odp.status() !== 200) return;
    const start = new URL(odp.url()).searchParams.get('start') || '0';
    try {
      fs.writeFileSync(path.join(KATALOG_RAW, `batch-${String(start).padStart(5, '0')}.json`),
                       await odp.text());
    } catch { /* odpowiedz mogla juz zniknac — raw/ jest opcjonalne */ }
  });

  // Przepuszczamy do terminala tylko postep pobierania i koncowe podsumowanie.
  // scrape-dom.js przy wstrzyknieciu probuje jeszcze zebrac karty widoczne na
  // stronie i marudzi, ze ich nie widzi — przy tej drodze to bez znaczenia,
  // bo dane i tak lecą z API, wiec nie straszymy tym uzytkownika.
  strona.on('console', (m) => {
    const t = m.text().replace(/%c/g, '').split(' color:')[0];
    if (t.includes('[api]') || t.includes('[zjedzmy] zapisano')) console.log(t);
  });

  await strona.goto(PANEL, { waitUntil: 'domcontentloaded' });
  if (!(await czekajNaLogowanie(strona))) { await ctx.close(); process.exit(1); }

  // Kolejnosc ma znaczenie: scrape-dom.js wnosi parser karty i scalanie kont,
  // api-scrape.js — pobieranie z API. addScriptTag nie czeka na zakonczenie
  // asynchronicznej petli w api-scrape.js, wiec na plik czekamy nizej.
  await strona.addScriptTag({ content: czytaj('scrape-dom.js') });
  await strona.addScriptTag({ content: czytaj('api-scrape.js') });

  console.log('\nPobieram — to potrwa ok. 10 minut. Nie zamykaj okna.\n');
  const pobranie = await strona.waitForEvent('download', { timeout: LIMIT_POBIERANIA });
  await pobranie.saveAs(WYJSCIE);

  const wierszy = fs.readFileSync(WYJSCIE, 'utf8').trim().split('\n').length - 1;
  console.log(`\nGotowe: ${WYJSCIE}`);
  console.log(`  osob w pliku: ${wierszy}`);
  console.log('  separator: srednik, kodowanie UTF-8 z BOM — polski Excel otworzy dwuklikiem');
  console.log('\nZanim ruszysz z kampania: filtruj po kolumnie zgoda_marketing.');

  await ctx.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('\nNie udalo sie:', e.message);
  console.error('Okno zostaje otwarte — mozesz sprobowac recznie: F12 -> Console ->');
  console.error('wklej scripts/scrape-dom.js, potem scripts/api-scrape.js.');
  process.exit(1);
});
