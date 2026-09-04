/** Check poem drafts and rebuild the full reading edition. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { parseArgs } from 'node:util';

export const ROOT = resolve(import.meta.dir, '..');
export const DATA = resolve(ROOT, 'poems/poems.json');
export const ARROWS = { right: '→', down: '↓', left: '←', up: '↑' } as const;
export type Direction = keyof typeof ARROWS;
export const FORMS = {
  rhyming_pair: ['right', 'down'],
  same_poem_square: ['right', 'down'],
  four_direction: ['right', 'down', 'left', 'up'],
  unrhymed_pair: ['right', 'down'],
} as const;
export type Form = keyof typeof FORMS;
export type Status = 'Selected' | 'Reserve' | 'Workshop';
export type Palette = 'beige' | 'green' | 'rose' | 'blue' | 'sage' | 'plum';
export const PALETTES = new Set<string>(['beige', 'green', 'rose', 'blue', 'sage', 'plum']);
export const PUBLIC_GROUPS: readonly (readonly [Form, string, string, readonly string[]])[] = [
  ['rhyming_pair', 'Rhyming pairs', '→ and ↓ produce different poems; both rhyme.', ['P02', 'R01', 'P03']],
  ['same_poem_square', 'Symmetric squares', '→ and ↓ produce the same poem.', ['N05', 'S01', 'S02']],
  ['four_direction', 'Omnidirectional poem', 'Readable in all → ↓ ← ↑ directions.', ['N04']],
];

export interface RhymeReference {
  families: Record<string, string[]>;
  readings: Record<string, { pinyin: string; final: string; conditional?: boolean }[]>;
}
export const RHYMES = JSON.parse(readFileSync(resolve(ROOT, 'poems/rhymes.json'), 'utf8')) as RhymeReference;
export interface Rhyme {
  family: string;
  across: string[];
  down: string[];
  compliance: 'pass' | 'conditional';
  caveat?: string;
}
export interface English {
  slug: string;
  title: string;
  lines: Record<string, string>;
  note?: string;
}
export interface Poem {
  id?: string;
  title?: string;
  collection: Form;
  rows: string[];
  directions?: Direction[];
  status?: Status;
  punctuation?: Partial<Record<Direction, string[]>>;
  originalRows?: string[];
  rhyme?: Rhyme | null;
  english?: English | null;
  palette?: Palette;
  imageUrl?: string;
}
export interface NamedPoem extends Poem { id: string; title: string }
export interface Collection { poems: NamedPoem[] }
export type Readings = { right: string[]; down: string[] } & Partial<Record<'left' | 'up', string[]>>;
export interface PoemReport {
  readings: Readings;
  transposeSymmetric: boolean;
  rotationSymmetric: boolean;
  distinctForward: number;
  distinctSupported: number;
  rhyme: 'pass' | 'conditional' | 'not claimed';
}
export interface CollectionReport {
  entries: number;
  dimensionsAndReadings: 'pass';
  strictRhymePairs: number;
  conditionalRhymePairs: number;
}

const HAN = /[\u4e00-\u9fff]/g;
const IMAGE_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const fullMatch = (pattern: RegExp, value: unknown): value is string =>
  typeof value === 'string' && pattern.exec(value)?.[0] === value;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isForm = (value: unknown): value is Form => typeof value === 'string' && Object.hasOwn(FORMS, value);
const sameItems = (value: unknown, expected: readonly unknown[]): boolean =>
  Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
const reverse = (line: string): string => [...line].reverse().join('');
const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');
const readMarkdown = (path: string): string => normalizeNewlines(readFileSync(path, 'utf8'));

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validGrid(rows: unknown): rows is string[] {
  return Array.isArray(rows) && rows.length === 5
    && rows.every(row => typeof row === 'string' && [...row].length === 5 && (row.match(HAN) ?? []).length === 5);
}

export function readings(poem: Pick<Poem, 'rows' | 'collection' | 'directions'>): Readings {
  const columns = Array.from({ length: 5 }, (_, index) => poem.rows.map(row => row[index]).join(''));
  const result: Readings = { right: poem.rows, down: columns };
  const directions: readonly Direction[] = poem.directions ?? FORMS[poem.collection];
  if (directions.includes('left')) result.left = poem.rows.map(reverse);
  if (directions.includes('up')) result.up = columns.map(reverse);
  return result;
}

/** A draft needs only its form, grid, and (for rhyming pairs) rhyme claims. */
export function validatePoem(poem: unknown, reference: RhymeReference = RHYMES): PoemReport {
  ensure(isObject(poem), 'A draft must be one poem object');
  const name = String(poem['id'] ?? 'Draft');
  const form = poem['collection'];
  ensure(isForm(form), name + ': unknown collection/form');
  const rows = poem['rows'];
  ensure(validGrid(rows), name + ': expected a 5×5 Chinese-character grid');
  ensure(sameItems(poem['directions'] === undefined ? FORMS[form] : poem['directions'], FORMS[form]), name + ': incorrect directions for form');
  const expected = readings({ rows, collection: form });
  const columns = expected.down;
  const symmetric = sameItems(rows, columns);
  ensure(form !== 'same_poem_square' || symmetric, name + ': square is not symmetric');
  ensure(!['rhyming_pair', 'unrhymed_pair'].includes(form) || !symmetric, name + ': poem-pair readings must differ');
  const status = poem['status'] === undefined ? 'Workshop' : poem['status'];
  ensure(status === 'Selected' || status === 'Reserve' || status === 'Workshop', name + ': invalid status');
  const punctuation = poem['punctuation'] === undefined ? {} : poem['punctuation'];
  ensure(isObject(punctuation), name + ': punctuation must map directions to lines');
  for (const [direction, lines] of Object.entries(punctuation)) {
    ensure(Object.hasOwn(expected, direction) && Array.isArray(lines) && lines.length === 5
      && lines.every((line): line is string => typeof line === 'string'), name + ': invalid punctuated reading');
    ensure(sameItems(lines.map(line => (line.match(HAN) ?? []).join('')), expected[direction as Direction]!),
      name + ': punctuation changed grid characters');
  }
  if ('originalRows' in poem) ensure(validGrid(poem['originalRows']), name + ': invalid original grid');

  const rhyme = poem['rhyme'];
  let rhymeResult: PoemReport['rhyme'] = 'not claimed';
  ensure(form !== 'rhyming_pair' || isObject(rhyme), name + ': rhyming pair requires rhyme metadata');
  if (rhyme !== undefined && rhyme !== null) {
    ensure(isObject(rhyme), name + ': invalid rhyme metadata');
    const family = rhyme['family'];
    const finals = typeof family === 'string' && Object.hasOwn(reference.families, family) ? reference.families[family] : undefined;
    ensure(finals !== undefined, name + ': unreviewed rhyme family');
    const compliance = rhyme['compliance'];
    ensure(compliance === 'pass' || compliance === 'conditional', name + ': invalid rhyme compliance');
    for (const [direction, key] of [['right', 'across'], ['down', 'down']] as const) {
      const pinyin = rhyme[key];
      ensure(Array.isArray(pinyin) && pinyin.length === 5, name + ': five rhyme pronunciations required');
      expected[direction].forEach((line, index) => {
        const character = line.at(-1)!;
        const matches = (reference.readings[character] ?? []).filter(item => item.pinyin === pinyin[index]);
        const [reading] = matches;
        ensure(matches.length === 1 && reading !== undefined, name + ': unreviewed pronunciation for ' + character
          + '; check its context and update poems/rhymes.json');
        ensure(finals.includes(reading.final), name + ': ending outside rhyme family');
        ensure(!reading.conditional || compliance === 'conditional', name + ': conditional pronunciation cannot pass strict rhyme');
      });
    }
    if (compliance === 'conditional') {
      ensure(typeof rhyme['caveat'] === 'string' && rhyme['caveat'].trim(), name + ': conditional rhyme needs a caveat');
    }
    ensure(form !== 'rhyming_pair' || status !== 'Selected' || compliance === 'pass', name + ': selected rhyming pair must pass');
    rhymeResult = compliance;
  }

  const english = poem['english'];
  if (english !== undefined && english !== null) {
    ensure(isObject(english), name + ': invalid English translations');
    ensure(fullMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, english['slug']), name + ': invalid export slug');
    ensure(typeof english['title'] === 'string' && english['title'].trim(), name + ': missing English title');
    const lines = english['lines'];
    const sourceLines = new Set(Object.values(expected).flat());
    ensure(isObject(lines) && Object.keys(lines).length === sourceLines.size
      && Object.keys(lines).every(line => sourceLines.has(line)), name + ': English lines do not match supported readings');
    ensure(Object.values(lines).every(line => typeof line === 'string' && line.trim()
      && !line.includes('\n') && !line.includes('\r')), name + ': empty or multiline English translation');
  }
  if ('palette' in poem) ensure(typeof poem['palette'] === 'string' && PALETTES.has(poem['palette']), name + ': invalid palette');
  if ('imageUrl' in poem) {
    ensure(fullMatch(IMAGE_URL, poem['imageUrl']), name + ': invalid GitHub image URL');
    ensure(english !== undefined && english !== null, name + ': poem card requires English translations');
  }
  return {
    readings: expected,
    transposeSymmetric: symmetric,
    rotationSymmetric: sameItems(rows, [...rows].reverse().map(reverse)),
    distinctForward: new Set([...rows, ...columns]).size,
    distinctSupported: new Set(Object.values(expected).flat()).size,
    rhyme: rhymeResult,
  };
}

export function validate(data: unknown): CollectionReport {
  ensure(isObject(data) && Array.isArray(data['poems']), 'Expected a poems list');
  const ids: string[] = [];
  const slugs: string[] = [];
  let strictRhymePairs = 0;
  let conditionalRhymePairs = 0;
  for (const poem of data['poems']) {
    ensure(isObject(poem), 'Expected a poem object');
    ensure(typeof poem['id'] === 'string' && poem['id'].trim(), 'Missing poem id');
    ensure(typeof poem['title'] === 'string' && poem['title'].trim(), 'Missing poem title');
    ids.push(poem['id']);
    const report = validatePoem(poem);
    if (isObject(poem['english'])) slugs.push(poem['english']['slug'] as string);
    if (poem['collection'] === 'rhyming_pair' && report.rhyme === 'pass') strictRhymePairs++;
    if (report.rhyme === 'conditional') conditionalRhymePairs++;
  }
  ensure(ids.length === new Set(ids).size, 'Duplicate poem ID');
  ensure(slugs.length === new Set(slugs).size, 'Duplicate export slug');
  return { entries: ids.length, dimensionsAndReadings: 'pass', strictRhymePairs, conditionalRhymePairs };
}

export function gridMarkdown(poem: Pick<Poem, 'rows'>): string {
  return '```text\n' + poem.rows.map(row => [...row].join(' ')).join('\n') + '\n```';
}

export function publicSelection(data: Collection): [string, string, NamedPoem[]][] {
  const byId = new Map(data.poems.map(poem => [poem.id, poem]));
  return PUBLIC_GROUPS.map(([collection, title, description, ids]) => {
    ensure(ids.every(id => byId.has(id)), 'Missing README selection');
    const poems = ids.map(id => byId.get(id)!);
    for (const poem of poems) {
      ensure(poem.collection === collection && poem.status === 'Selected', 'Invalid README selection: ' + poem.id);
      ensure(poem.english && poem.imageUrl, 'Featured poem requires translations and an image URL');
    }
    return [title, description, poems];
  });
}

export function validateReadme(data: Collection, current: string): void {
  const expected = publicSelection(data).flatMap(([, , poems]) => poems.map(poem => poem.rows));
  const actual = [...normalizeNewlines(current).matchAll(/```text\n([\s\S]*?)\n```/g)].map(match => {
    const block = match[1];
    ensure(block !== undefined, 'Missing fenced grid capture');
    return block.split(/\r?\n/).map(line => line.replace(/\s/g, ''));
  });
  ensure(actual.length === expected.length && actual.every((grid, index) => {
    const selected = expected[index];
    return selected !== undefined && sameItems(grid, selected);
  }),
    'README poem grids differ from the featured selection; update README.md manually');
}

export function morePoemsMarkdown(data: Collection): string {
  const groups: [Form, string, string][] = PUBLIC_GROUPS.map(([form, title, description]) =>
    [form, form === 'four_direction' ? 'Omnidirectional poems' : title, description]);
  groups.push(['unrhymed_pair', 'Unrhymed pairs', '→ and ↓ produce different poems; rhyme is not required.']);
  const out = ['# More poems · 全集'];
  for (const [collection, title, description] of groups) {
    out.push('## ' + title, description);
    for (const poem of data.poems) {
      if (poem.collection !== collection) continue;
      const raw = readings(poem);
      const symmetric = poem.collection === 'same_poem_square';
      const labels: string[] = [poem.status ?? 'Workshop'];
      const rhyme = poem.rhyme;
      if (rhyme) {
        labels.push(rhyme.family);
        if (rhyme.compliance === 'conditional') labels.push('Conditional rhyme');
      }
      const heading = `《${poem.title}》`;
      out.push('### ' + heading);
      if (poem.imageUrl) out.push(`![${heading}：诗歌方阵、英文翻译与阅读方向](${poem.imageUrl})`);
      out.push(labels.join(' · '), gridMarkdown(poem));
      const directions: Direction[] = symmetric ? ['right'] : Object.keys(raw) as Direction[];
      const headers = symmetric ? ['→ = ↓'] : directions.map(direction => ARROWS[direction]);
      const lines = directions.map(direction => poem.punctuation?.[direction] ?? raw[direction]!);
      const table = ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |'];
      for (let index = 0; index < 5; index++) table.push('| ' + lines.map(group => group[index]).join(' | ') + ' |');
      const expanded = [table.join('\n')];
      if (rhyme) {
        for (const [direction, key] of [['right', 'across'], ['down', 'down']] as const) {
          const endings = raw[direction].map((line, index) => line.at(-1) + ' ' + rhyme[key][index]);
          expanded.push('**' + ARROWS[direction] + ' rhyme endings:** ' + endings.join(' · '));
        }
      }
      out.push('<details>\n<summary>Readings: ' + headers.join(' / ') + '</summary>\n\n'
        + expanded.join('\n\n') + '\n\n</details>');
    }
  }
  return out.join('\n\n') + '\n';
}

export function generatedOutputs(input: unknown): { checks: CollectionReport; outputs: Map<string, string> } {
  const checks = validate(input);
  const data = input as Collection;
  validateReadme(data, readMarkdown(resolve(ROOT, 'README.md')));
  return { checks, outputs: new Map([[resolve(ROOT, 'more_poems.md'), morePoemsMarkdown(data)]]) };
}

export function main(args: string[] = process.argv.slice(2)): number {
  let values: { check?: boolean; draft?: string; help?: boolean };
  try {
    ({ values } = parseArgs({ args, options: {
      check: { type: 'boolean' }, draft: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } }));
    ensure(!(values.check && values.draft !== undefined), '--check and --draft are mutually exclusive');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (values.help) {
    console.log('Usage: bun scripts/build.ts [--check | --draft FILE]\n\n'
      + 'Check poem drafts and rebuild the full reading edition.\n\n'
      + '  --check       Check generated Markdown without writing it\n'
      + '  --draft FILE  Check one draft JSON file and print its computed readings');
    return 0;
  }
  try {
    if (values.draft !== undefined) {
      const draft: unknown = JSON.parse(readFileSync(values.draft, 'utf8'));
      console.log(JSON.stringify(validatePoem(draft), null, 2));
      return 0;
    }
    const data: unknown = JSON.parse(readFileSync(DATA, 'utf8'));
    const { checks, outputs } = generatedOutputs(data);
    for (const [path, content] of outputs) {
      if (values.check) {
        let current: string | undefined;
        try { current = readMarkdown(path); } catch { /* Missing output is stale. */ }
        ensure(current === content, 'Generated file is stale: ' + relative(ROOT, path) + '; run bun scripts/build.ts');
      } else writeFileSync(path, content, 'utf8');
    }
    console.log(JSON.stringify(checks));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
