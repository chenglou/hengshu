import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  ROOT, RHYMES, generatedOutputs, gridMarkdown, morePoemsMarkdown, publicSelection,
  readings, validate, validatePoem, validateReadme,
  type Collection, type English, type NamedPoem, type Poem,
} from '../scripts/build.ts';

const canonical = JSON.parse(readFileSync(resolve(ROOT, 'poems/poems.json'), 'utf8')) as Collection;
let data: Collection;
beforeEach(() => { data = structuredClone(canonical); });

function required<T>(value: T | null | undefined, description: string): T {
  if (value === null || value === undefined) throw new Error('Missing fixture ' + description);
  return value;
}

function poem(id: string): NamedPoem {
  const found = data.poems.find(item => item.id === id);
  if (!found) throw new Error('Missing fixture ' + id);
  return found;
}

function english(item: Poem): English {
  if (!item.english) throw new Error('Missing English fixture');
  return item.english;
}

function readMarkdown(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
}

function grids(document: string): string[] {
  return [...document.matchAll(/```text\n([\s\S]*?)\n```/g)]
    .map(match => required(match[1], 'fenced grid capture').split('\n').map(line => line.replace(/\s/g, '')).join('\n'));
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}

describe('collection', () => {
  test('generated documents match canonical data', () => {
    const { outputs } = generatedOutputs(data);
    for (const [path, expected] of outputs) {
      expect(dirname(path)).not.toBe(resolve(ROOT, 'poems'));
      expect(readMarkdown(path)).toBe(expected);
    }
  });

  test('README prose does not affect grid validation', () => {
    const current = readMarkdown(resolve(ROOT, 'README.md'));
    validateReadme(data, '# A hand-edited introduction\n\n' + current + '\nA different process summary.\n');
    validateReadme(data, current.replace(/\n/g, '\r\n'));
  });

  test('rejects README grid drift', () => {
    const current = readMarkdown(resolve(ROOT, 'README.md'));
    const firstRow = required(poem('P02').rows[0], 'P02 first row');
    const edited = current.replace([...firstRow].join(' '), '人 去 旧 柳 寒');
    expect(() => validateReadme(data, edited)).toThrow('README poem grids differ');
  });

  test('public editions preserve grids and complete coverage', () => {
    const { outputs } = generatedOutputs(data);
    const complete = grids(outputs.get(resolve(ROOT, 'more_poems.md'))!);
    const featured = grids(readMarkdown(resolve(ROOT, 'README.md')));
    expect([...complete].sort()).toEqual(data.poems.map(item => item.rows.join('\n')).sort());
    expect(featured).toHaveLength(7);
    expect(new Set(featured).size).toBe(featured.length);
    expect(featured.every(grid => complete.includes(grid))).toBe(true);
  });

  test('poem images are embedded in reading editions', () => {
    const { outputs } = generatedOutputs(data);
    const current = readMarkdown(resolve(ROOT, 'README.md'));
    const complete = outputs.get(resolve(ROOT, 'more_poems.md'))!;
    const headingAndImage = (item: NamedPoem) => {
      const title = `《${item.title}》`;
      return `### ${title}\n\n![${title}：诗歌方阵、英文翻译与阅读方向](${item.imageUrl})`;
    };
    for (const item of data.poems) {
      expect(complete).toContain(headingAndImage(item));
      expect(complete.split(item.imageUrl!).length - 1).toBe(1);
    }
    for (const [, , selected] of publicSelection(data)) {
      for (const item of selected) expect(current).toContain(headingAndImage(item) + '\n\n' + gridMarkdown(item));
    }
  });

  test('full edition has no intro or navigation boilerplate', () => {
    const complete = morePoemsMarkdown(data);
    expect(complete.startsWith('# More poems · 全集\n\n## Rhyming pairs\n')).toBe(true);
    expect(complete.endsWith('</details>\n')).toBe(true);
    expect(complete).not.toContain('Featured in README');
  });

  test('symmetric four-direction grid keeps backward readings', () => {
    const draft: NamedPoem = { id: 'NEW', title: '测试', collection: 'four_direction', rows: poem('S01').rows };
    const report = validatePoem(draft);
    expect(report.transposeSymmetric).toBe(true);
    const document = morePoemsMarkdown({ poems: [draft] });
    expect(document).toContain('Readings: → / ↓ / ← / ↑');
    expect(document).toContain(required(report.readings.left?.[0], 'first backward reading'));
  });

  test('rejects missing or invalid image URLs', () => {
    for (const id of ['P02', 'P01']) {
      const item = poem(id);
      const original = required(item.imageUrl, id + ' image URL');
      for (const url of [null, 'poems/image.md', 'https://example.com/image.png', original + '\n', original + '\r', original + '\u2028']) {
        Reflect.set(item, 'imageUrl', url);
        expect(() => validate(data)).toThrow('invalid GitHub image URL');
      }
      item.imageUrl = original;
    }
  });

  test('poem card requires translation source', () => {
    delete poem('F02').english;
    expect(() => validate(data)).toThrow('F02: poem card requires English translations');
  });

  test('rejects missing or empty English lines', () => {
    const item = poem('N04');
    const raw = required(readings(item).up?.[0], 'first upward reading');
    const lines = english(item).lines;
    const original = required(lines[raw], 'upward translation');
    delete lines[raw];
    expect(() => validate(data)).toThrow('English lines do not match');
    lines[raw] = '';
    expect(() => validate(data)).toThrow('empty or multiline English');
    lines[raw] = original;
  });

  test('rejects unsafe or duplicate export slugs', () => {
    const translation = english(poem('P02'));
    for (const slug of ['../README', 'safe-slug\n', 'safe-slug\r', 'safe-slug\u2028']) {
      translation.slug = slug;
      expect(() => validate(data)).toThrow('invalid export slug');
    }
    translation.slug = english(poem('R01')).slug;
    expect(() => validate(data)).toThrow('Duplicate export slug');
  });

  test('rejects missing characters and linebreaks in grids', () => {
    const item = poem('P02');
    const original = required(item.rows[0], 'P02 first row');
    for (const row of ['人归旧柳', original + '\n', original + '\r', original + '\u2028']) {
      item.rows[0] = row;
      expect(() => validate(data)).toThrow('expected a 5×5 Chinese-character grid');
    }
  });

  test('computes four directions without stored readings', () => {
    const report = validatePoem({ collection: 'four_direction', rows: poem('F02').rows });
    expect(report.readings.down).toEqual(['我听你等风', '等雨问风听', '你听不问我', '问山听雨等', '风问我等你']);
    expect(report.readings.left).toEqual(['风问你等我', '问山听雨听', '我听不问你', '等雨问风等', '你等我听风']);
    expect(report.readings.up).toEqual(['风等你听我', '听风问雨等', '我问不听你', '等雨听山问', '你等我问风']);
    expect(report.distinctSupported).toBe(20);
  });

  test('rejects punctuation that changes text', () => {
    poem('P03').punctuation!.right![0] = '相对才念旧，';
    expect(() => validate(data)).toThrow('punctuation changed grid characters');
  });

  test('rejects wrong rhyme families', () => {
    poem('P02').rhyme!.family = '十欧';
    expect(() => validate(data)).toThrow('ending outside rhyme family');
  });

  test('rejects wrong contextual pronunciation', () => {
    poem('R02').rhyme!.across[4] = 'hái';
    expect(() => validate(data)).toThrow('unreviewed pronunciation');
  });

  test('conditional rhyme cannot enter selection', () => {
    poem('N02').status = 'Selected';
    expect(() => generatedOutputs(data)).toThrow('selected rhyming pair must pass');
  });

  test('draft CLI needs no collection or publication metadata', () => {
    const path = resolve(ROOT, 'poems/poems.json');
    const before = readFileSync(path);
    for (const id of ['R01', 'S01']) {
      const item = poem(id);
      const draft = { collection: item.collection, rows: item.rows, ...(item.rhyme ? { rhyme: item.rhyme } : {}) };
      const directory = mkdtempSync(join(tmpdir(), 'hengshu-draft-'));
      try {
        const input = join(directory, 'draft.json');
        writeFileSync(input, JSON.stringify(draft));
        const result = spawnSync(process.execPath, [resolve(ROOT, 'scripts/build.ts'), '--draft', input], { cwd: directory, encoding: 'utf8' });
        expect(result.status).toBe(0);
        const report = JSON.parse(result.stdout) as ReturnType<typeof validatePoem>;
        expect(report.readings.right).toEqual(item.rows);
        expect(report.transposeSymmetric).toBe(id === 'S01');
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    expect(readFileSync(path)).toEqual(before);
  });

  test('draft checks form and declared directions', () => {
    const draft: Poem = { collection: 'same_poem_square', rows: poem('S01').rows, directions: ['right'] };
    expect(() => validatePoem(draft)).toThrow('incorrect directions');
    delete draft.directions;
    draft.rows = poem('R01').rows;
    expect(() => validatePoem(draft)).toThrow('not symmetric');
  });

  test('rhyme checks can use an additional reviewed reading', () => {
    const item = poem('N01');
    const rhyme = required(item.rhyme, 'N01 rhyme');
    const draft: Poem = { collection: item.collection, rows: item.rows, rhyme };
    rhyme.across[2] = 'huǎng';
    expect(() => validatePoem(draft)).toThrow('unreviewed pronunciation');
    const reference = structuredClone(RHYMES);
    required(reference.readings['晃'], '晃 pronunciations').push({ pinyin: 'huǎng', final: 'uang' });
    expect(validatePoem(draft, reference).rhyme).toBe('pass');
  });

  test('conditional reading cannot be relabelled as strict', () => {
    poem('N02').rhyme!.compliance = 'pass';
    expect(() => validate(data)).toThrow('conditional pronunciation');
  });

  test('local Markdown links resolve', () => {
    const documents = [
      ...readdirSync(ROOT).filter(name => name.endsWith('.md')).map(name => resolve(ROOT, name)),
      ...markdownFiles(resolve(ROOT, 'docs')),
    ];
    for (const document of documents) {
      const text = readMarkdown(document);
      for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
        const target = required(match[1], 'Markdown link target');
        if (target.includes('://') || target.startsWith('#') || target.startsWith('mailto:')) continue;
        const local = decodeURIComponent(target.replace(/#.*$/, '').replace(/^<|>$/g, ''));
        expect(existsSync(resolve(dirname(document), local))).toBe(true);
      }
    }
  });

  test('rejects malformed runtime fields instead of trusting TypeScript types', () => {
    const draft = { collection: 'same_poem_square', rows: poem('S01').rows };
    const fields: Record<string, unknown[]> = {
      collection: [null, [], '__proto__', 'toString'], rows: [null, [], [1, 2, 3, 4, 5]],
      directions: [null, {}, ['right']], status: [null, [], ''], punctuation: [null, [], { toString: [] }],
      palette: [null, [], 'toString'], originalRows: [null, []], rhyme: [[], false, { family: '__proto__' }],
      english: [[], false, { slug: [], title: '', lines: {} }],
    };
    for (const [field, values] of Object.entries(fields)) {
      for (const value of values) expect(() => validatePoem({ ...draft, [field]: value })).toThrow();
    }
    for (const invalid of [null, [], true, 'poem']) expect(() => validatePoem(invalid)).toThrow('one poem object');
    for (const invalid of [null, [], { poems: null }, { poems: [null] }]) expect(() => validate(invalid)).toThrow();
  });

  test('draft CLI rejects invalid JSON and incompatible modes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hengshu-invalid-'));
    try {
      const input = join(directory, 'draft.json');
      for (const source of ['{', 'null', '[]']) {
        writeFileSync(input, source);
        const result = spawnSync(process.execPath, [resolve(ROOT, 'scripts/build.ts'), '--draft', input], { encoding: 'utf8' });
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).not.toBe('');
      }
      const result = spawnSync(process.execPath, [resolve(ROOT, 'scripts/build.ts'), '--check', '--draft', input], { encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('mutually exclusive');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('check mode accepts a CRLF checkout without rewriting it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hengshu-crlf-'));
    try {
      for (const subdirectory of ['scripts', 'poems']) mkdirSync(join(directory, subdirectory));
      for (const file of ['scripts/build.ts', 'poems/poems.json', 'poems/rhymes.json']) {
        writeFileSync(join(directory, file), readFileSync(resolve(ROOT, file)));
      }
      const markdown = ['README.md', 'more_poems.md'].map(file => [file, readMarkdown(resolve(ROOT, file)).replace(/\n/g, '\r\n')] as const);
      for (const [file, text] of markdown) writeFileSync(join(directory, file), text);
      const result = spawnSync(process.execPath, [join(directory, 'scripts/build.ts'), '--check'], { cwd: directory, encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      for (const [file, text] of markdown) expect(readFileSync(join(directory, file), 'utf8')).toBe(text);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
