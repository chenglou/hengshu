import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { computeReadings, canReverseLineOrder, preparePoem, preparePoems, parseArgs, type CollectionName, type Direction } from '../scripts/render-cards.ts';

function draft(rows: string[] = ['甲乙丙丁戊', '己庚辛壬癸', '子丑寅卯辰', '巳午未申酉', '戌亥天地方'], collection: CollectionName = 'unrhymed_pair') {
  const readings = computeReadings(rows);
  const directions: Direction[] = collection === 'four_direction' ? ['right', 'down', 'left', 'up'] : ['right', 'down'];
  const lines = [...new Set(directions.flatMap(direction => readings[direction]))];
  const poem: { id: string; title: string; collection: CollectionName; rows: string[];
    readings?: unknown; directions?: unknown; english: { slug: string; title: string; lines: Record<string, string> } } = { id: 'draft', title: '试作', collection, rows,
    english: { slug: 'a-new-draft', title: 'A New Draft', lines: Object.fromEntries(lines.map((line, index) => [line, `English line ${index + 1}.`])) } };
  return poem;
}

test('a single new draft needs no stored readings, checks, status, or publication data', () => {
  const input = draft();
  input.readings = { down: ['stale data'] };
  const [poem] = preparePoems(input);
  assert.ok(poem);
  assert.equal(poem.readings.down[0], '甲己子巳戌');
  assert.equal(poem.translations.down.length, 5);
  assert.equal(poem.palette, 'beige');
});

test('reverse shortcut requires both backward poems to equal reversed forward line order', () => {
  const reversible = preparePoem(draft(['甲乙丙丁戊', '己庚辛壬癸', '子丑寅丑子', '癸壬辛庚己', '戊丁丙乙甲'], 'four_direction'));
  assert.equal(canReverseLineOrder(reversible), true);
  const up = reversible.translations.up;
  assert.ok(up);
  up[0] = 'A different meaning.';
  assert.equal(canReverseLineOrder(reversible), false);
  const genuine = preparePoem(draft(undefined, 'four_direction'));
  assert.equal(canReverseLineOrder(genuine), false);
  assert.equal(new Set(Object.values(genuine.readings).flat()).size, 20);
});

test('symmetric cards must really share the across and down poem', () => {
  const symmetric = draft(['甲乙丙丁戊', '乙丙丁戊甲', '丙丁戊甲乙', '丁戊甲乙丙', '戊甲乙丙丁'], 'same_poem_square');
  assert.deepEqual(preparePoem(symmetric).translations.right, preparePoem(symmetric).translations.down);
  assert.throws(() => preparePoem(draft(undefined, 'same_poem_square')), /not symmetric/);
  assert.throws(() => preparePoem({ ...symmetric, collection: 'rhyming_pair' }), /different across and down/);
});

test('reject malformed rows and incomplete or unsupported translation keys', () => {
  assert.throws(() => computeReadings(['一二三四五']), /five rows/);
  assert.throws(() => computeReadings(['一二三四五', '一二三四五', '一二三四五', '一二三四五', '一二三四!']), /Chinese characters/);
  assert.throws(() => computeReadings(['一二三四五', '一二三四五', '一二三四五', '一二三四五', '一二三四〇']), /Chinese characters/);
  for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    assert.throws(() => computeReadings(['一二三四五', '一二三四五', '一二三四五', '一二三四五', `一二三四五${ending}`]), /Chinese characters/);
  }
  const input = draft();
  const [firstRow] = input.rows;
  assert.ok(firstRow);
  delete input.english.lines[firstRow];
  assert.throws(() => preparePoem(input), /translation for 甲乙丙丁戊/);
  input.english.lines[firstRow] = 'Line one.\nLine two.';
  assert.throws(() => preparePoem(input), /single-line/);
  input.english.lines[firstRow] = 'One line.';
  input.english.lines['不是诗中行'] = 'Unused.';
  assert.throws(() => preparePoem(input), /not a supported reading/);
});

test('reject unsafe filenames, unknown palettes, and malformed directions', () => {
  const input = draft();
  input.english.slug = '../../escape';
  assert.throws(() => preparePoem(input), /slug/);
  for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029', ' ']) {
    input.english.slug = `safe${ending}`;
    assert.throws(() => preparePoem(input), /slug/);
  }
  input.english.slug = 'safe';
  assert.throws(() => preparePoem(input, 'unknown'), /unknown palette/);
  for (const directions of [['right'], ['down', 'right'], null]) {
    input.directions = directions;
    assert.throws(() => preparePoem(input), /directions/);
  }
});

test('batch selection, palette override, and duplicate filenames are checked', () => {
  const first = draft();
  const second = draft();
  second.id = 'second';
  second.english.slug = 'second';
  const data = { poems: [first, second] };
  assert.equal(preparePoems(data).length, 2);
  const [selected] = preparePoems(data, { poemId: 'second', palette: 'plum' });
  assert.ok(selected);
  assert.equal(selected.palette, 'plum');
  assert.throws(() => preparePoems(data, { poemId: 'missing' }), /Unknown poem ID/);
  second.english.slug = first.english.slug;
  assert.throws(() => preparePoems(data), /Duplicate poem slug/);
  assert.throws(() => preparePoems({ poems: [] }), /No poems/);
});

test('defaults are repository-relative; explicit paths are working-directory-relative', () => {
  const defaults = parseArgs([], '/tmp');
  assert.equal(defaults.input, path.resolve(import.meta.dir, '../poems/poems.json'));
  assert.equal(defaults.output, path.resolve(import.meta.dir, '../output/cards'));
  const explicit = parseArgs(['--input', 'draft.json', '--output', 'cards', '--poem', 'D01', '--palette', 'sage'], '/tmp');
  assert.equal(explicit.input, '/tmp/draft.json');
  assert.equal(explicit.output, '/tmp/cards');
  assert.equal(explicit.poemId, 'D01');
  assert.throws(() => parseArgs(['--input']), /Missing value/);
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
  for (const inheritedKey of ['toString', 'constructor', '__proto__']) {
    assert.throws(() => parseArgs([inheritedKey, 'value']), /Unknown argument/);
  }
});
