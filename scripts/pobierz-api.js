/* ------------------------------------------------------------------
 * pobierz-api.js  —  caly eksport jednym poleceniem
 *
 *   npm install     (raz — playwright + chromium)
 *   npm start       (albo: node scripts/pobierz-api.js)
 *
 * Otwiera okno przegladarki na Zjedz.my. Jesli nie jestes zalogowany,
 * czeka az zalogujesz sie RECZNIE — skrypt nigdy nie widzi Twojego hasla.
 * Potem sam sprawdza, do ktorych restauracji ma dostep Twoje konto,
 * pobiera baze klientow i zapisuje ja jako klienci-<restauracja>.csv.
 * Jedna restauracja to ok. 10 minut przy 7000 kontaktow.
 *
 * Masz kilka lokali? Skrypt zapyta, ktory eksportowac — albo zrobi
 * wszystkie po kolei. Mozna tez wskazac go z gory:
 *   node scripts/pobierz-api.js nazwa-restauracji-z-adresu
 *
 * Co sie tu dzieje: cala robota (pobieranie, parsowanie kart, scalanie kont,
 * zapis CSV) siedzi w scripts/scrape-dom.js + scripts/api-scrape.js, czyli
 * w tych samych plikach, ktore mozna wkleic recznie do konsoli przegladarki.
 * Ten skrypt tylko otwiera okno, wstrzykuje je i lapie gotowy plik. Dzieki
 * temu obie drogi licza dokladnie to samo — nie ma drugiej implementacji,
 * ktora moglaby sie rozjechac.
 *
 * Przy okazji odklada surowe odpowiedzi API do raw/<restauracja>/. Nie sa
 * do niczego potrzebne, ale pozwalaja przeliczyc CSV bez ruszania serwera:
 *   python3 parsuj_api.py raw/<restauracja>
 * ------------------------------------------------------------------ */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const KORZEN = path.resolve(__dirname, '..');
const PROFIL = path.join(KORZEN, '.profil-przegladarki');
const WSKAZANA = process.argv.slice(2).find((a) => !a.startsWith('-')) || null;

const MINUTA = 60_000;
const LIMIT_LOGOWANIA = 15 * MINUTA;
const LIMIT_POBIERANIA = 45 * MINUTA;   // ~10 min przy 7 tys. kontaktow, z duzym zapasem

const pauza = (ms) => new Promise((r) => setTimeout(r, ms));
const czytaj = (plik) => fs.readFileSync(path.join(__dirname, plik), 'utf8');
const panel = (slug) => `https://zjedz.my/${slug}/profile#company-users`;

/* --- logowanie --------------------------------------------------- */

// Zalogowanego poznajemy po odnosnikach do wlasnego profilu w naglowku strony —
// wylogowany nie ma ich wcale. Sam adres nie wystarczy, bo Zjedz.my po zalogowaniu
// zostawia czlowieka w roznych miejscach.
const zalogowany = (strona) =>
  strona.evaluate(() => !!document.querySelector('a[href*="/profile/user"]'));

async function czekajNaLogowanie(strona) {
  await strona.goto('https://zjedz.my/', { waitUntil: 'domcontentloaded' });
  if (await zalogowany(strona)) return true;

  await strona.goto('https://zjedz.my/login', { waitUntil: 'domcontentloaded' });
  console.log('\n>>> Zaloguj sie w otwartym oknie przegladarki. Czekam...\n');

  for (let i = 0; i < LIMIT_LOGOWANIA / 3000; i++) {
    await pauza(3000);
    // Dopoki stoi na formularzu, nie ruszamy strony — przeladowanie skasowaloby
    // to, co wlasnie wpisuje.
    if (strona.url().includes('/login')) continue;
    if (!(await zalogowany(strona))) {
      await strona.goto('https://zjedz.my/', { waitUntil: 'domcontentloaded' });
      if (!(await zalogowany(strona))) continue;
    }
    console.log('Zalogowano.\n');
    return true;
  }
  console.error('Nie doczekalem sie logowania.');
  return false;
}

/* --- ktore restauracje sa moje ----------------------------------- */

// Po zalogowaniu Zjedz.my pokazuje w bocznym menu odnosniki do paneli tych
// restauracji, ktorymi zarzadza konto. To jedyne miejsce, po ktorym da sie
// je poznac — ogolnego adresu w rodzaju /panel serwis nie ma.
async function znajdzRestauracje(strona) {
  await strona.goto('https://zjedz.my/', { waitUntil: 'domcontentloaded' });
  return strona.evaluate(() => {
    const mapa = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      const m = (a.getAttribute('href') || '').match(/^https:\/\/zjedz\.my\/([a-z0-9-]+)\/profile$/);
      if (!m) continue;
      // W odnosniku jest nazwa lokalu, a pod nia rola ('Wlasciciel') — bierzemy
      // sama nazwe, czyli pierwsza niepusta linie.
      const nazwa = (a.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
      if (nazwa || !mapa.has(m[1])) mapa.set(m[1], nazwa || m[1]);
    }
    return [...mapa].map(([slug, nazwa]) => ({ slug, nazwa }));
  });
}

// Jedno lekkie zapytanie: 200 znaczy dostep, przy okazji mamy liczbe klientow.
async function sprawdzDostep(strona, slug) {
  return strona.evaluate(async (slug) => {
    const url = `https://zjedz.my/${slug}/profile/ajax/datatables/users?draw=1&start=0&length=1`;
    const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include' });
    if (res.status !== 200) return { status: res.status };
    try { return { status: 200, klientow: (await res.json()).recordsTotal }; }
    catch { return { status: 200, klientow: null }; }
  }, slug);
}

async function wybierz(dostepne) {
  if (dostepne.length === 1) return dostepne;

  console.log('\nTwoje konto ma dostep do kilku restauracji:\n');
  dostepne.forEach((r, i) => console.log(`  ${i + 1}. ${r.nazwa}  (${r.klientow} klientow)`));
  console.log(`  ${dostepne.length + 1}. wszystkie po kolei`);

  if (!process.stdin.isTTY) {
    console.log('\nUruchom ponownie, podajac ktora:');
    dostepne.forEach((r) => console.log(`  npm start -- ${r.slug}`));
    return null;
  }

  const pytanie = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const odp = (await pytanie.question(`\nKtora? [1-${dostepne.length + 1}] `)).trim();
      const n = Number(odp);
      if (n >= 1 && n <= dostepne.length) return [dostepne[n - 1]];
      if (n === dostepne.length + 1) return dostepne;
      console.log('Nie rozumiem — wpisz sam numer z listy.');
    }
  } finally {
    pytanie.close();
  }
}

/* --- eksport jednej restauracji ---------------------------------- */

// Kazda restauracja dostaje WLASNA, swieza karte. Przejscie miedzy panelami
// w jednej karcie konczy sie tym, ze Zjedz.my ja ubija (ERR_ABORTED, a po
// chwili zamkniecie) — nowa karta wchodzaca prosto na panel dziala bez problemu.
async function eksportuj(ctx, restauracja) {
  const wyjscie = path.join(KORZEN, `klienci-${restauracja.slug}.csv`);
  const strona = await ctx.newPage();
  podepnijNasluch(strona);

  console.log(`\n========================================`);
  console.log(`  ${restauracja.nazwa}  —  ${restauracja.klientow} klientow`);
  console.log(`========================================\n`);

  await strona.goto(panel(restauracja.slug), { waitUntil: 'domcontentloaded' });
  await pauza(3000);                       // niech zakladka zdazy sie doladowac

  // Kolejnosc ma znaczenie: scrape-dom.js wnosi parser karty i scalanie kont,
  // api-scrape.js — pobieranie z API. addScriptTag nie czeka na zakonczenie
  // asynchronicznej petli w api-scrape.js, wiec na plik czekamy nizej.
  await strona.addScriptTag({ content: czytaj('scrape-dom.js') });
  await strona.addScriptTag({ content: czytaj('api-scrape.js') });

  console.log('Pobieram — to potrwa kilka minut. Nie zamykaj okna.\n');

  // Czekamy na gotowy plik ALBO na powod przerwania — bez tego drugiego
  // odmowa dostepu konczylaby sie kwadransami ciszy i timeoutem.
  const nigdy = () => new Promise(() => {});
  const wynik = await Promise.race([
    strona.waitForEvent('download', { timeout: LIMIT_POBIERANIA })
          .then((d) => ({ plik: d })).catch(nigdy),
    strona.waitForFunction(() => window.__zmBlad || false, null, { timeout: LIMIT_POBIERANIA })
          .then((uchwyt) => uchwyt.jsonValue()).then((powod) => ({ powod })).catch(nigdy),
    new Promise((_, odrzuc) => setTimeout(
      () => odrzuc(new Error('minelo 45 minut bez rezultatu')), LIMIT_POBIERANIA)),
  ]);

  if (wynik.powod) {
    console.error('\nEksport przerwany.\n');
    console.error(String(wynik.powod).split('\n').map((l) => '  ' + l).join('\n'));
    await strona.close().catch(() => {});
    return null;
  }

  await wynik.plik.saveAs(wyjscie);
  await strona.close().catch(() => {});
  const wierszy = fs.readFileSync(wyjscie, 'utf8').trim().split('\n').length - 1;
  console.log(`\nZapisane: ${path.basename(wyjscie)}  (${wierszy} osob)`);
  return wyjscie;
}

/* --- nasluch na karcie ------------------------------------------- */

function podepnijNasluch(strona) {
  // Surowe odpowiedzi API lapiemy po drodze, zamiast pobierac je drugi raz.
  strona.on('response', async (odp) => {
    const m = odp.url().match(/^https:\/\/zjedz\.my\/([a-z0-9-]+)\/profile\/ajax\/datatables\/users/);
    if (!m || odp.status() !== 200) return;
    const paramy = new URL(odp.url()).searchParams;
    if (paramy.get('length') === '1') return;          // to tylko sonda dostepu
    try {
      const katalog = path.join(KORZEN, 'raw', m[1]);
      fs.mkdirSync(katalog, { recursive: true });
      const nazwa = `batch-${String(paramy.get('start') || '0').padStart(5, '0')}.json`;
      fs.writeFileSync(path.join(katalog, nazwa), await odp.text());
    } catch { /* odpowiedz mogla juz zniknac — raw/ jest opcjonalne */ }
  });

  // przepuszczamy do terminala tylko postep i koncowe podsumowanie
  strona.on('console', (m) => {
    const t = m.text().replace(/%c/g, '').split(' color:')[0];
    if (t.includes('[api]') || t.includes('[zjedzmy] zapisano')) console.log(t);
  });
}

/* --- calosc ------------------------------------------------------ */

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFIL, {
    headless: false, viewport: null, locale: 'pl-PL', timezoneId: 'Europe/Warsaw',
  });
  const strona = ctx.pages()[0] || await ctx.newPage();

  podepnijNasluch(strona);

  if (!(await czekajNaLogowanie(strona))) { await ctx.close(); process.exit(1); }

  const znalezione = await znajdzRestauracje(strona);
  const kandydaci = WSKAZANA ? [{ slug: WSKAZANA, nazwa: WSKAZANA }] : znalezione;

  const dostepne = [];
  for (const r of kandydaci) {
    const w = await sprawdzDostep(strona, r.slug);
    if (w.status === 200) dostepne.push({ ...r, klientow: w.klientow });
    else if (WSKAZANA) console.error(`\nDo restauracji "${r.slug}" Twoje konto nie ma dostepu (HTTP ${w.status}).`);
  }

  if (!dostepne.length) {
    console.error('\nNie znalazlem zadnej restauracji, do ktorej to konto ma dostep.\n');
    if (znalezione.length) {
      console.error('Widze w Twoim menu: ' + znalezione.map((r) => r.slug).join(', '));
      console.error('ale baza klientow jest dla nich zamknieta — poproś wlasciciela lokalu');
      console.error('o dodanie Cie w panelu, w sekcji "Pracownicy".');
    } else {
      console.error('Zalogowane konto nie zarzadza zadnym lokalem. Zaloguj sie na konto');
      console.error('z dostepem managerskim albo poproś wlasciciela o dodanie Cie');
      console.error('w panelu restauracji, w sekcji "Pracownicy".');
    }
    await ctx.close();
    process.exit(1);
  }

  const wybrane = await wybierz(dostepne);
  if (!wybrane) { await ctx.close(); process.exit(1); }

  const pliki = [];
  for (const r of wybrane) {
    const plik = await eksportuj(ctx, r);
    if (plik) pliki.push(plik);
  }

  console.log('\n----------------------------------------');
  if (pliki.length) {
    console.log('Gotowe:');
    pliki.forEach((p) => console.log('  ' + p));
    console.log('\nSeparator: srednik, kodowanie UTF-8 z BOM — polski Excel otworzy dwuklikiem.');
    console.log('\nZanim ruszysz z kampania: filtruj po kolumnie zgoda_marketing.');
  } else {
    console.log('Nie powstal zaden plik.');
  }

  await ctx.close();
  process.exit(pliki.length ? 0 : 1);
})().catch(async (e) => {
  console.error('\nNie udalo sie:', e.message);
  console.error('Okno zostaje otwarte — mozesz sprobowac recznie: F12 -> Console ->');
  console.error('wklej scripts/scrape-dom.js, potem scripts/api-scrape.js.');
  process.exit(1);
});
