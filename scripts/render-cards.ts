#!/usr/bin/env bun
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Browser, Page } from 'playwright';

const REPO = path.resolve(import.meta.dir, '..');
export const PALETTES = ['beige', 'green', 'rose', 'blue', 'sage', 'plum'] as const;
const COLLECTIONS = ['rhyming_pair', 'same_poem_square', 'four_direction', 'unrhymed_pair'] as const;
const CJK_FONTS = ['Songti SC', 'Noto Serif SC', 'SimSun', 'Noto Serif CJK SC'];

export type Direction = 'right' | 'down' | 'left' | 'up';
export type CollectionName = typeof COLLECTIONS[number];
export type Palette = typeof PALETTES[number];
type Readings = Record<Direction, string[]>;
type Translations = Pick<Readings, 'right' | 'down'> & Partial<Pick<Readings, 'left' | 'up'>>;
export interface PreparedPoem {
  id: string; title: string; collection: CollectionName; rows: string[];
  directions: Direction[]; readings: Readings; palette: Palette;
  slug: string; englishTitle: string; translations: Translations;
}
interface SelectionOptions { poemId?: string; palette?: string }
interface CliOptions extends SelectionOptions { input: string; output: string; help?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/u.test(value)) {
    throw new Error(`${label}: expected nonempty, single-line text`);
  }
}

export function computeReadings(rows: unknown): Readings {
  if (!Array.isArray(rows) || rows.length !== 5 || rows.some(row =>
    typeof row !== 'string' || row.length !== 5 || !/^[\u4e00-\u9fff]{5}$/u.test(row))) {
    throw new Error('rows: expected five rows of five Chinese characters each');
  }
  const lines = rows as string[];
  const matrix = lines.map(row => [...row]);
  const down = [0, 1, 2, 3, 4].map(column => matrix.map(row => row[column]).join(''));
  return { right: [...lines], down, left: matrix.map(row => [...row].reverse().join('')),
    up: down.map(line => [...line].reverse().join('')) };
}

export function canReverseLineOrder(poem: PreparedPoem): boolean {
  return poem.collection === 'four_direction' && ([['left', 'right'], ['up', 'down']] as const).every(([backward, forward]) =>
    isDeepStrictEqual(poem.readings[backward], [...poem.readings[forward]].reverse()) &&
    isDeepStrictEqual(poem.translations[backward], [...poem.translations[forward]].reverse()));
}

export function preparePoem(input: unknown, paletteOverride?: string): PreparedPoem {
  if (!isRecord(input)) throw new Error('Expected a poem object');
  requireText(input['id'], 'id');
  requireText(input['title'], `${input['id']} title`);
  if (!COLLECTIONS.includes(input['collection'] as CollectionName)) throw new Error(`${input['id']}: unknown collection`);
  const readings = computeReadings(input['rows']);
  const directions: Direction[] = input['collection'] === 'four_direction' ? ['right', 'down', 'left', 'up'] : ['right', 'down'];
  if ('directions' in input && (!Array.isArray(input['directions']) ||
    !isDeepStrictEqual(input['directions'], directions))) {
    throw new Error(`${input['id']}: directions do not match ${input['collection']}`);
  }
  const same = isDeepStrictEqual(readings.right, readings.down);
  if (input['collection'] === 'same_poem_square' && !same) throw new Error(`${input['id']}: square is not symmetric`);
  if (['rhyming_pair', 'unrhymed_pair'].includes(input['collection'] as string) && same) throw new Error(`${input['id']}: a pair must have different across and down readings`);
  if (!input['english'] || typeof input['english'] !== 'object') throw new Error(`${input['id']}: missing English translations`);
  const english = input['english'] as Record<string, unknown>;
  requireText(english['title'], `${input['id']} English title`);
  if (typeof english['slug'] !== 'string' || /\s/u.test(english['slug']) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(english['slug'])) {
    throw new Error(`${input['id']}: English slug must be lowercase letters/numbers separated by hyphens`);
  }
  if (!english['lines'] || typeof english['lines'] !== 'object' || Array.isArray(english['lines'])) {
    throw new Error(`${input['id']}: missing English line map`);
  }
  const englishLines = english['lines'] as Record<string, unknown>;
  const supported = new Set(directions.flatMap(direction => readings[direction]));
  for (const line of supported) requireText(englishLines[line], `${input['id']} translation for ${line}`);
  for (const line of Object.keys(english['lines'])) {
    if (!supported.has(line)) throw new Error(`${input['id']}: translation key is not a supported reading: ${line}`);
  }
  const palette = paletteOverride ?? input['palette'] ?? 'beige';
  if (!PALETTES.includes(palette as Palette)) throw new Error(`${input['id']}: unknown palette ${palette}; choose ${PALETTES.join(', ')}`);
  return { id: input['id'], title: input['title'], collection: input['collection'] as CollectionName, rows: [...readings.right],
    directions, readings, palette: palette as Palette, slug: english['slug'], englishTitle: english['title'],
    translations: Object.fromEntries(directions.map(direction => [direction, readings[direction].map(line => englishLines[line] as string)])) as Translations };
}

export function preparePoems(data: unknown, { poemId, palette }: SelectionOptions = {}): PreparedPoem[] {
  const source = isRecord(data) && Array.isArray(data['poems']) ? data['poems'] as unknown[] : [data];
  if (!source.length) throw new Error('No poems to render');
  const selected = poemId === undefined ? source : source.filter(poem => isRecord(poem) && poem['id'] === poemId);
  if (!selected.length) throw new Error(`Unknown poem ID: ${poemId}`);
  const poems = selected.map(poem => preparePoem(poem, palette));
  for (const key of ['id', 'slug'] as const) {
    if (new Set(poems.map(poem => poem[key])).size !== poems.length) throw new Error(`Duplicate poem ${key}`);
  }
  return poems;
}

export function parseArgs(argv: string[], cwd = process.cwd()): CliOptions {
  const options: CliOptions = { input: path.join(REPO, 'poems/poems.json'), output: path.join(REPO, 'output/cards') };
  const keys = new Map<string, 'input' | 'output' | 'poemId' | 'palette'>([
    ['--input', 'input'], ['--output', 'output'], ['--poem', 'poemId'], ['--palette', 'palette'],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const key = arg === undefined ? undefined : keys.get(arg);
    if (key === undefined) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    options[key] = key === 'input' || key === 'output' ? path.resolve(cwd, value) : value;
  }
  return options;
}

// CDP reports fonts actually used for each glyph, unlike document.fonts.check,
// which can succeed merely because a fallback exists. Reject missing-font tofu.
async function checkCjkFonts(page: Page, fontOverride?: string): Promise<string[]> {
  const expected = fontOverride ? [fontOverride] : CJK_FONTS;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument');
    const { nodeIds } = await client.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.han, .poem-name' });
    const used = new Set<string>();
    for (const nodeId of nodeIds) {
      const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
      if (!fonts.length || fonts.some(font => font.glyphCount < 1 ||
        !expected.some(name => font.familyName.toLowerCase() === name.toLowerCase()))) {
        throw new Error(`Missing CJK glyph font (rendered: ${fonts.map(font => font.familyName).join(', ') || 'none'}). ` +
          `Install Noto Serif SC or Noto Serif CJK SC, or set CJK_FONT to an installed Chinese font family.`);
      }
      fonts.forEach(font => used.add(font.familyName));
    }
    return [...used];
  } finally { await client.detach(); }
}

export async function renderPoem(browser: Browser, template: string, css: string, poem: PreparedPoem,
  { sharp, fontOverride }: { sharp: typeof import('sharp').default; fontOverride?: string }) {
  const fontOption = fontOverride === undefined ? {} : { fontOverride };
  const reverseOrder = canReverseLineOrder(poem);
  const page = await browser.newPage({ viewport: { width: 940, height: 1800 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  try {
    await page.setContent(template);
    await page.addStyleTag({ content: css });
    await page.evaluate(({ poem, reverseOrder, fontOverride }) => {
      const root = document.getElementById('hengshu-card')!;
      const poster = root.querySelector<HTMLElement>('.poem-poster')!;
      const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      };
      root.dataset['palette'] = poem.palette;
      poster.setAttribute('aria-label', `${poem.title} · ${poem.englishTitle}: bilingual poem card`);
      if (fontOverride) poster.style.setProperty('--han-font', JSON.stringify(fontOverride) + ', serif');
      root.querySelector('.poem-name')!.textContent = poem.title;
      root.querySelector('.english-name')!.textContent = poem.englishTitle;
      document.title = `${poem.title} · ${poem.englishTitle} — hengshu`;
      const matrix = root.querySelector('.across-grid')!;
      const symmetric = poem.collection === 'same_poem_square';
      const numbered = symmetric || poem.collection === 'four_direction';
      matrix.append(element('div', 'reading-label grid-label'),
        element('div', 'reading-label across-label', symmetric ? '→ ACROSS = ↓ DOWN' : '→ ACROSS'));
      poem.rows.forEach((row, index) => {
        [...row].forEach(character => {
          const cell = element('span', 'han', character);
          cell.lang = 'zh-Hans';
          matrix.append(cell);
        });
        const line = element('p', numbered ? 'across-line numbered' : 'across-line');
        if (numbered) line.append(element('span', 'across-key', String(index + 1)));
        line.append(element('span', 'across-text', poem.translations.right[index]));
        matrix.append(line);
      });
      for (let index = 0; index < 5; index++) matrix.append(element('span', 'column-key', String(index + 1)));
      const appendStanza = (container: Element, texts: string[], reverse = false) => texts.forEach((text, index) => {
        const line = element('div', reverse ? 'reverse-line' : 'down-line');
        line.append(element('span', 'verse-key', String(index + 1)), element('p', reverse ? 'reverse-text' : 'verse-text', text));
        container.append(line);
      });
      if (symmetric) root.querySelector('.down-reading')!.remove();
      else appendStanza(root.querySelector('.down-lines')!, poem.translations.down);
      if (reverseOrder) {
        const note = element('div', 'reverse-note');
        note.append(element('span', '', '← Across lines 5–1'), element('span', '', '↑ Down lines 5–1'));
        root.querySelector('.poster-footer')!.before(note);
      } else if (poem.collection === 'four_direction') {
        const reverse = element('section', 'reverse-readings');
        reverse.setAttribute('aria-label', 'The two backward readings, translated in full');
        for (const [direction, label] of [['left', '← REVERSED ROWS'], ['up', '↑ REVERSED COLUMNS']] as const) {
          const stanza = element('section', 'reverse-stanza');
          stanza.dataset['direction'] = direction;
          stanza.append(element('div', 'reading-label', label));
          const lines = element('div', 'reverse-lines');
          appendStanza(lines, poem.translations[direction]!, true);
          stanza.append(lines);
          reverse.append(stanza);
        }
        root.querySelector('.poster-footer')!.before(reverse);
      }
      // Matching page and card backgrounds avoids a white fractional crop edge.
      const paper = getComputedStyle(poster).backgroundColor;
      document.body.style.backgroundColor = paper;
      document.documentElement.style.backgroundColor = paper;
    }, { poem, reverseOrder, ...fontOption });
    await page.evaluate(() => document.fonts.ready);
    const fonts = await checkCjkFonts(page, fontOverride);
    const checks = await page.evaluate(() => {
      const poster = document.querySelector('.poem-poster')!;
      const rect = poster.getBoundingClientRect();
      const measure = (node: Element) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const bounds = range.getBoundingClientRect();
        return { text: node.textContent, lineCount: new Set([...range.getClientRects()].map(fragment => fragment.top)).size,
          fits: bounds.right <= rect.right - 40 + .5 && bounds.width <= node.getBoundingClientRect().width + .5 };
      };
      return {
        width: rect.width, height: rect.height,
        across: [...poster.querySelectorAll('.across-text')].map(measure),
        down: [...poster.querySelectorAll('.verse-text')].map(measure),
        reverse: Object.fromEntries([...poster.querySelectorAll<HTMLElement>('.reverse-stanza')].map(stanza =>
          [stanza.dataset['direction']!, [...stanza.querySelectorAll('.reverse-text')].map(measure)])),
        chinese: [...poster.querySelectorAll('.han')].map(node => node.textContent).join(''),
        background: getComputedStyle(poster).backgroundColor,
        footerBorder: getComputedStyle(poster.querySelector('.poster-footer')!).borderTopWidth,
        overflow: [...poster.querySelectorAll('*')].filter(node => {
          const bounds = node.getBoundingClientRect();
          return bounds.left < rect.left || bounds.right > rect.right + .5 || bounds.bottom > rect.bottom + .5;
        }).map(node => node.className),
      };
    });
    if (checks.chinese !== poem.rows.join('')) throw new Error(`${poem.id}: Chinese changed during rendering`);
    for (const [direction, lines] of Object.entries({ right: checks.across, down: checks.down, ...checks.reverse })) {
      const expected = direction === 'down' && poem.collection === 'same_poem_square' ? [] : poem.translations[direction as Direction];
      if (!isDeepStrictEqual(lines.map(line => line.text), expected)) throw new Error(`${poem.id}: ${direction} translation changed`);
    }
    const badLines = [...checks.across, ...checks.down, ...Object.values(checks.reverse).flat()].filter(line => line.lineCount !== 1 || !line.fits);
    if (badLines.length) throw new Error(`${poem.id}: translation wraps or overflows: ${badLines.map(line => line.text).join(' / ')}`);
    if (checks.overflow.length || checks.footerBorder !== '0px') throw new Error(`${poem.id}: card overflow or unexpected footer rule`);
    if (errors.length) throw new Error(`${poem.id}: ${errors.join('; ')}`);
    const png = await page.locator('.poem-poster').screenshot({ animations: 'disabled' });
    const metadata = await sharp(png).metadata();
    if (metadata.width !== 1880) throw new Error(`${poem.id}: incorrect export width`);
    if (metadata.height === undefined) throw new Error(`${poem.id}: missing export height`);
    const paper = checks.background.match(/\d+/g)!.slice(0, 3).map(Number);
    const corners: [number, number][] = [[0, 0], [metadata.width - 1, 0], [0, metadata.height - 1], [metadata.width - 1, metadata.height - 1]];
    for (const [left, top] of corners) {
      const pixel = await sharp(png).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      if (!isDeepStrictEqual([...pixel], paper)) throw new Error(`${poem.id}: inconsistent crop-edge background`);
    }
    return { png, html: await page.content(), manifest: { id: poem.id, title: poem.title, slug: poem.slug,
      palette: poem.palette, collection: poem.collection, png: `${poem.slug}.png`, html: `${poem.slug}.html`,
      pixelWidth: metadata.width, pixelHeight: metadata.height, fonts, reverseLineOrder: reverseOrder,
      translatedLines: checks.across.length + checks.down.length + Object.values(checks.reverse).flat().length } };
  } finally { await page.close(); }
}

async function main(argv = Bun.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: bun scripts/render-cards.ts [--input FILE] [--poem ID] [--output DIR] [--palette NAME]\n' +
      'Defaults: poems/poems.json and output/cards, relative to the repository. Explicit paths are relative to your working directory.\n' +
      `Palettes: ${PALETTES.join(', ')}. Optional environment: CJK_FONT, CHROMIUM_EXECUTABLE_PATH.`);
    return;
  }
  // Validate the complete requested batch before launching a browser or writing files.
  const poems = preparePoems(JSON.parse(await fs.readFile(options.input, 'utf8')), options);
  const fontOverride = process.env['CJK_FONT'];
  if (fontOverride !== undefined) requireText(fontOverride, 'CJK_FONT');
  const { chromium } = await import('playwright');
  const { default: sharp } = await import('sharp');
  const [template, css] = await Promise.all([
    fs.readFile(path.join(REPO, 'cards/template.html'), 'utf8'), fs.readFile(path.join(REPO, 'cards/poster.css'), 'utf8'),
  ]);
  const executablePath = process.env['CHROMIUM_EXECUTABLE_PATH'];
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const renderOptions = { sharp, ...(fontOverride === undefined ? {} : { fontOverride }) };
  const results = [];
  try {
    for (const poem of poems) results.push(await renderPoem(browser, template, css, poem, renderOptions));
  } finally { await browser.close(); }
  // No partial card set is published when a line or font check fails.
  await fs.mkdir(options.output, { recursive: true });
  for (const result of results) {
    await fs.writeFile(path.join(options.output, result.manifest.png), result.png);
    await fs.writeFile(path.join(options.output, result.manifest.html), result.html);
  }
  await fs.writeFile(path.join(options.output, 'manifest.json'), JSON.stringify(results.map(result => result.manifest), null, 2) + '\n');
  console.log(`Rendered ${results.length} card${results.length === 1 ? '' : 's'} to ${options.output}`);
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
