from pathlib import Path
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'poems'
DATA = BASE / 'poems.json'
HAN = re.compile(r'[\u4e00-\u9fff]')
LABELS = {'right': 'Across →', 'down': 'Down ↓', 'left': 'Reversed rows ←', 'up': 'Reversed columns ↑'}
ARROWS = {'right': '→', 'down': '↓', 'left': '←', 'up': '↑'}
READING_RULES = ('Arrows indicate the direction within each line. Keep rows in top-to-bottom '
                 'order and columns in left-to-right order. No diagonal or arbitrary-path readings are claimed.')
PUBLIC_GROUPS = (
    ('rhyming_pair', 'Rhyming pairs', '→ and ↓ produce different poems; both rhyme.',
     ('P02', 'R01', 'P03')),
    ('same_poem_square', 'Symmetric squares', '→ and ↓ produce the same poem.',
     ('N05', 'S01', 'S02')),
    ('four_direction', 'Omnidirectional poem', 'Readable in all → ↓ ← ↑ directions.',
     ('N04',)),
)

# Contextual readings independently checked by the editor and peer readers.
PHONETICS = {
    '晚': ('wǎn', 'uan'), '烟': ('yān', 'ian'), '漫': ('màn', 'an'),
    '远': ('yuǎn', 'üan'), '天': ('tiān', 'ian'), '寒': ('hán', 'an'),
    '山': ('shān', 'an'), '连': ('lián', 'ian'), '雁': ('yàn', 'ian'),
    '难': ('nán', 'an'), '还': ('huán', 'uan'), '滩': ('tān', 'an'),
    '帆': ('fān', 'an'), '旧': ('jiù', 'iou'), '友': ('yǒu', 'ou'),
    '守': ('shǒu', 'ou'), '楼': ('lóu', 'ou'), '修': ('xiū', 'iou'),
    '墙': ('qiáng', 'iang'), '上': ('shàng', 'ang'), '晃': ('huàng', 'uang'),
    '窗': ('chuāng', 'uang'), '光': ('guāng', 'uang'),
    '乐': ('lè', 'e'), '了': ('le', 'e'), '么': ('me', 'e'),
    '姐': ('jiě', 'ie'), '饿': ('è', 'e'),
    '诗': ('shī', '-i'), '意': ('yì', 'i'), '寄': ('jì', 'i'),
    '知': ('zhī', '-i'), '己': ('jǐ', 'i'), '此': ('cǐ', '-i'), '笔': ('bǐ', 'i'),
    '酒': ('jiǔ', 'iou'), '后': ('hòu', 'ou'), '留': ('liú', 'iou'),
    '酬': ('chóu', 'ou'), '掩': ('yǎn', 'ian'), '有': ('yǒu', 'ou'),
    '瘦': ('shòu', 'ou'), '手': ('shǒu', 'ou'), '绣': ('xiù', 'iou'),
    '愁': ('chóu', 'ou'),
}
FAMILIES = {'十一安': {'an', 'ian', 'uan', 'üan'}, '十欧': {'ou', 'iou'},
            '十三昂': {'ang', 'iang', 'uang'}, '三鹅': {'e', 'ie', 'üe'},
            '四衣': {'i', '-i'}}


def is_new(p, data):
    if data.get('currentRound'):
        return p.get('roundId') == data['currentRound']
    return p['origin'].startswith('2026-09-03')


def validate(data):
    ids = [p['id'] for p in data['poems']]
    assert len(ids) == len(set(ids)), 'Duplicate poem ID'
    indexed = []
    for section in data['sections']:
        if section.get('groups'):
            indexed.extend(i for group in section['groups'] for i in group['poemIds'])
        else:
            indexed.extend(section['poemIds'])
    assert sorted(indexed) == sorted(ids), 'Missing or duplicate collection entry'
    strict = conditional = 0
    for p in data['poems']:
        rows = p['rows']
        assert len(rows) == 5 and all(len(r) == 5 and len(HAN.findall(r)) == 5 for r in rows), p['id']
        cols = [''.join(row[j] for row in rows) for j in range(5)]
        expected = {'right': rows, 'down': cols}
        if 'left' in p['directions']:
            expected['left'] = [r[::-1] for r in rows]
        if 'up' in p['directions']:
            expected['up'] = [r[::-1] for r in cols]
        assert p['readings'] == expected, 'Reading mismatch: ' + p['id']
        for direction, lines in p.get('punctuation', {}).items():
            assert len(lines) == 5
            assert [''.join(HAN.findall(line)) for line in lines] == expected[direction], 'Punctuation changed letters: ' + p['id']
        assert p['checks']['distinctForward'] == len(set(rows + cols))
        assert p['checks']['distinctSupported'] == len(set(line for lines in expected.values() for line in lines))
        assert p['checks']['transposeSymmetric'] == (rows == cols)
        assert p['checks']['rotationSymmetric'] == (rows == [r[::-1] for r in rows[::-1]])
        if p.get('source'):
            source = (BASE / p['source']).read_text(encoding='utf-8')
            grids = [[''.join(line.split()) for line in block.splitlines()]
                     for block in re.findall(r'```text\n(.*?)\n```', source, re.S)]
            assert rows in grids, 'Earlier wording altered: ' + p['id']
        rhyme = p.get('rhyme')
        if rhyme:
            for direction, key in [('right', 'across'), ('down', 'down')]:
                ends = [line[-1] for line in expected[direction]]
                assert rhyme[key] == [PHONETICS[c][0] for c in ends]
                assert all(PHONETICS[c][1] in FAMILIES[rhyme['family']] for c in ends)
            if rhyme.get('compliance') == 'conditional':
                assert p['id'] == 'N02' and rhyme.get('caveat'), 'Unexplained conditional rhyme'
                conditional += 1
            else:
                assert '么' not in rows[-1] and not any(r[-1] == '么' for r in rows)
                strict += 1
    return {'entries': len(ids), 'newEntries': sum(is_new(p, data) for p in data['poems']),
            'selectedRhymingPairs': sum(p['collection'] == 'rhyming_pair' and p['status'] == 'Selected' for p in data['poems']),
            'strictRhymePairs': strict, 'conditionalRhymePairs': conditional,
            'dimensionsAndReadings': 'pass', 'earlierWordingPreserved': True,
            'punctuationPreservesGrid': True}


def quoted(lines):
    return '\n'.join('> ' + line + '  ' for line in lines)


def entry(p, rank, level, new=False):
    out = ['#' * level + f' {rank}.《{p["title"]}》 — {p["status"]}',
           '**' + ('New this round' if new else 'Earlier entry') + '** · ' + p['formLabel'],
           '```text\n' + '\n'.join(' '.join(row) for row in p['rows']) + '\n```']
    for direction in p['directions']:
        if direction == 'down' and p['checks']['transposeSymmetric']:
            continue
        label = 'Across → and down ↓ — identical' if p['checks']['transposeSymmetric'] else LABELS[direction]
        lines = p.get('punctuation', {}).get(direction, p['readings'][direction])
        out.extend(['**' + label + '**', quoted(lines)])
    if p.get('rhyme'):
        rhyme = p['rhyme']
        out.append('**Rhyme:** ' + rhyme['family'] + ' · ' + ' / '.join(rhyme['finals']) + ' · tones unrestricted.')
        for direction, key in [('right', 'across'), ('down', 'down')]:
            values = [line[-1] + ' ' + py for line, py in zip(p['readings'][direction], rhyme[key])]
            out.append(('→ ' if direction == 'right' else '↓ ') + ' · '.join(values))
        if rhyme.get('caveat'):
            out.append('**Rhyme limitation:** ' + rhyme['caveat'])
    out.extend(['**Why here:** ' + p['curation']['reason'], '**Limit:** ' + p['curation']['weakness']])
    if p['curation'].get('reading'):
        out.append('**Reading:** ' + p['curation']['reading'])
    if p.get('revisionNote'):
        out.append('**Revision record:** ' + p['revisionNote'])
    if p.get('originalRows'):
        out.append('Original pre-repair grid, retained for the record:\n\n```text\n' + '\n'.join(p['originalRows']) + '\n```')
    if p.get('titleNote'):
        out.append('*' + p['titleNote'] + '*')
    return '\n\n'.join(out)


def markdown(data, checks):
    by_id = {p['id']: p for p in data['poems']}
    out = ['# 简体五乘五诗集',
           f'Ranked collection · {data["updated"]} · {checks["entries"]} entries, including {checks["newEntries"]} additions.',
           '**Start with the [selected rhyming poems](selected.md).** This complete collection also retains reserve pieces, workshop drafts, and the earlier forms.',
           '## Reading rules and selection',
           'Collection 1 contains rhyming poem-pairs: rows left to right, taken top to bottom, form one poem; columns top to bottom, taken left to right, form the other. All five line endings must rhyme in each reading. Backwards and diagonal readings are not required.',
           'Collection 2 preserves the earlier, unrhymed forms and their new additions. Same-poem squares, reversible grids, and unrestricted forward pairs are kept in separate ranked groups. This retains both the symmetric and reversible kinds from the older experiments without conflating their reading rules.',
           'Every grid has five rows of five simplified Chinese characters. Punctuation belongs to the displayed readings, not the 25-cell grid. A written 儿 counts as one character even when pronounced as erhua.',
           'Ranks are editorial judgments within a form, not numerical measurements. The order prioritizes the weaker reading’s language and whole-poem coherence, then memorable specificity and the change of meaning achieved by the grid. Mechanical correctness is a gate, not an aesthetic score. Selected means recommended now; Reserve means readable but secondary; Workshop means a useful experiment with unresolved weaknesses.',
           'Rhyme uses the modern Mandarin families in [《中华通韵》, GF 0022—2019](https://www.moe.gov.cn/jyb_sjzl/ziliao/A19/202111/W020211118492193544846.pdf). Different medials can belong to one family; 四衣 also groups i and the apical-vowel readings written i. No classical tone-pattern claim is made.',
           data['editorialSummary']]
    for section in data['sections']:
        out.append('## ' + section['title'])
        if section.get('intro'):
            out.append(section['intro'])
        groups = section.get('groups') or [{'label': section['label'], 'poemIds': section['poemIds']}]
        for group in groups:
            if section.get('groups'):
                out.append('### ' + group['label'])
            table = ['| Rank | Poem | Status | Main reason |', '|---|---|---|---|']
            for rank, pid in enumerate(group['poemIds'], 1):
                p = by_id[pid]
                table.append(f'| {rank} | 《{p["title"]}》' + (' · new' if is_new(p, data) else '') + f' | {p["status"]} | {p["curation"]["short"]} |')
            out.append('\n'.join(table))
            out.extend(entry(by_id[pid], rank, 4 if section.get('groups') else 3, is_new(by_id[pid], data)) for rank, pid in enumerate(group['poemIds'], 1))
    out.extend(['## Review record', data['reviewRecord'], '## Verification',
                f'- {checks["entries"]} grids: dimensions and every claimed reading checked.\n- All earlier grids match their source documents exactly.\n- Punctuated readings preserve every grid character and its order.\n- {checks["strictRhymePairs"]} rhyming pairs pass the declared contextual-pronunciation checks.\n- {checks["conditionalRhymePairs"]} rhyming draft is explicitly conditional and excluded from strict selection.\n- Simplified character forms and literary interpretations were checked by readers; the character-array checks do not prove fluency.',
                'The bottom row supplies every vertical ending, and the rightmost column supplies every horizontal ending. They share the lower-right character, so all-line-rhyming pairs necessarily share a rhyme family under a consistent classification.',
                '## Earlier records',
                '- [Initial three poems](../archive/2d-poems.md)\n- [First fresh-agent round](../archive/fresh-2d-poems-audit.md)\n- [Earlier rhyming round](../archive/rhyming-2d-poems.md)',
                'The editable inventory is [poems.json](poems.json). Earlier source documents have not been overwritten.'])
    return '\n\n'.join(out) + '\n'


def selected_markdown(data):
    by_id = {p['id']: p for p in data['poems']}
    section = next(s for s in data['sections'] if s['id'] == 'rhyming')
    selected = [by_id[pid] for pid in section['poemIds'] if by_id[pid]['status'] == 'Selected']
    assert selected and all(p['rhyme']['compliance'] == 'pass' for p in selected)
    assert all(not p['checks']['transposeSymmetric'] for p in selected)
    out = ['# 横读竖读 · 双向押韵诗选',
           f'{len(selected)} selected grids · Simplified Chinese · {data["updated"]}',
           'Each square contains two five-line poems. Read rows left to right, in top-to-bottom order; read columns top to bottom, in left-to-right order. Every line ends in the stated modern Mandarin rhyme family. Reverse readings and classical tone patterns are not required.',
           'The order is editorial, judged first by the less fluent of the two readings. Earlier selections are preserved alongside new work; workshop drafts are excluded from this reading edition. The [complete collection and review record](collection.md) retains them separately.']
    for rank, p in enumerate(selected, 1):
        right = p.get('punctuation', {}).get('right', p['readings']['right'])
        down = p.get('punctuation', {}).get('down', p['readings']['down'])
        out.extend([f'## {rank}.《{p["title"]}》',
                    'New selection.' if is_new(p, data) else 'Retained from an earlier round.',
                    '```text\n' + '\n'.join(' '.join(row) for row in p['rows']) + '\n```',
                    '| 横读 → | 竖读 ↓ |\n|---|---|\n' + '\n'.join(f'| {a} | {b} |' for a,b in zip(right, down)),
                    '**韵脚 · ' + p['rhyme']['family'] + '**\n\n' + '\n\n'.join(
                        arrow + ' ' + ' · '.join(line[-1] + ' ' + py for line, py in zip(p['readings'][direction], p['rhyme'][key]))
                        for arrow,direction,key in [('→','right','across'),('↓','down','down')]),
                    p.get('selectionNote', p['curation']['reason']),
                    '**Editorial reservation:** ' + p['curation']['weakness']])
    out.extend(['## Rhyme and text checks',
                'All included grids contain exactly 25 Chinese characters; every displayed column has been recomputed from the square. The two readings are not identical. All ten line endings per grid have checked contextual pronunciations within one family of [《中华通韵》, GF 0022—2019](https://www.moe.gov.cn/jyb_sjzl/ziliao/A19/202111/W020211118492193544846.pdf). Tones may differ. Rhyme correctness is separate from the editorial judgment of poetic quality.',
                'For the earlier same-poem squares and reversible poems, see [Collection 2 in the complete collection](collection.md). Their different constraints are not presented as equivalent to this selection.'])
    return '\n\n'.join(out) + '\n'


def grid_markdown(p):
    return '```text\n' + '\n'.join(' '.join(row) for row in p['rows']) + '\n```'


def public_selection(data):
    by_id = {p['id']: p for p in data['poems']}
    groups = []
    for collection, title, description, ids in PUBLIC_GROUPS:
        poems = [by_id[pid] for pid in ids]
        for p in poems:
            assert p['collection'] == collection and p['status'] == 'Selected', 'Invalid README selection: ' + p['id']
            if collection == 'rhyming_pair':
                assert p['rhyme']['compliance'] == 'pass' and not p['checks']['transposeSymmetric']
            elif collection == 'same_poem_square':
                assert p['checks']['transposeSymmetric']
            else:
                assert set(p['directions']) == set(ARROWS)
        groups.append((title, description, poems))
    return groups


def readme_markdown(data):
    groups = public_selection(data)
    out = ['# 横竖有诗 · hengshu',
           'A collection of 2D Chinese poems, generated & curated by GPT Astra. '
           'These poems, unlike traditional ones, can be read in various different directions!',
           "Below's a curated subset. The full set is in [more_poems.md](more_poems.md)."]
    for title, description, poems in groups:
        out.extend(['## ' + title, description])
        for p in poems:
            out.extend([f'### 《{p["title"]}》', grid_markdown(p)])
    out.append('Created through AI writing, collaborative revision, and AI cross-review. '
               '[Editorial notes and history](poems/collection.md) · [Editing and checks](docs/editing.md).')
    return '\n\n'.join(out) + '\n'


def more_poems_markdown(data):
    by_id = {p['id']: p for p in data['poems']}
    featured = {p['id'] for _, _, poems in public_selection(data) for p in poems}
    ordered = []
    for section in data['sections']:
        for group in section.get('groups') or [section]:
            ordered.extend(group['poemIds'])
    groups = [(collection, title, description) for collection, title, description, _ in PUBLIC_GROUPS]
    groups[2] = ('four_direction', 'Omnidirectional poems', groups[2][2])
    groups.append(('unrhymed_pair', 'Unrhymed pairs',
                   '→ and ↓ produce different poems; rhyme is not required.'))
    out = ['# More poems · 全集',
           f'All {len(data["poems"])} grids, including the {len(featured)} featured in the [README](README.md).',
           '**Selected** means recommended; **Reserve** means secondary; **Workshop** marks an experiment with unresolved weaknesses. '
           'The [editorial collection](poems/collection.md) records the rankings, reservations, and review history.',
           READING_RULES,
           'Rhyming pairs use modern Mandarin rhyme families, with tones unrestricted. '
           '《姐姐》 is a conditional-rhyme draft, explicitly marked below. The other forms have no rhyme requirement.']
    for collection, title, description in groups:
        out.extend(['## ' + title, description])
        for pid in ordered:
            p = by_id[pid]
            if p['collection'] != collection:
                continue
            labels = [p['status']]
            if pid in featured:
                labels.append('Featured in README')
            if p.get('rhyme'):
                labels.append(p['rhyme']['family'])
                if p['rhyme']['compliance'] == 'conditional':
                    labels.append('Conditional rhyme')
            out.extend([f'### 《{p["title"]}》', ' · '.join(labels), grid_markdown(p)])
            if p.get('rhyme', {}).get('caveat'):
                out.append('**Rhyme caveat:** ' + p['rhyme']['caveat'])
            directions = ['right'] if p['checks']['transposeSymmetric'] else p['directions']
            headers = ['→ = ↓'] if p['checks']['transposeSymmetric'] else [ARROWS[d] for d in directions]
            readings = [p.get('punctuation', {}).get(d, p['readings'][d]) for d in directions]
            table = ['| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join('---' for _ in headers) + ' |']
            table.extend('| ' + ' | '.join(lines) + ' |' for lines in zip(*readings))
            expanded = ['\n'.join(table)]
            if p.get('rhyme'):
                for direction, key in [('right', 'across'), ('down', 'down')]:
                    endings = [line[-1] + ' ' + py for line, py in zip(p['readings'][direction], p['rhyme'][key])]
                    expanded.append('**' + ARROWS[direction] + ' rhyme endings:** ' + ' · '.join(endings))
            out.append('<details>\n<summary>Readings: ' + ' / '.join(headers) + '</summary>\n\n'
                       + '\n\n'.join(expanded) + '\n\n</details>')
    out.extend(['---', '[Back to the seven-poem selection](README.md) · '
                '[Editorial notes and AI review history](poems/collection.md) · [Earlier experiments](archive/README.md).'])
    return '\n\n'.join(out) + '\n'


def generated_outputs(data):
    assert data['status'] == 'complete', 'Do not publish unfinished rankings'
    checks = validate(data)
    return checks, {
        ROOT / 'README.md': readme_markdown(data),
        ROOT / 'more_poems.md': more_poems_markdown(data),
        BASE / 'collection.md': markdown(data, checks),
        BASE / 'selected.md': selected_markdown(data),
        BASE / 'checks.json': json.dumps(checks, ensure_ascii=False, indent=2) + '\n',
    }


def main():
    parser = argparse.ArgumentParser(description='Validate and build the Hengshu reading documents.')
    parser.add_argument('--check', action='store_true', help='Validate and check generated files without writing them.')
    args = parser.parse_args()
    data = json.loads(DATA.read_text(encoding='utf-8'))
    checks, outputs = generated_outputs(data)
    if args.check:
        stale = [str(path.relative_to(ROOT)) for path, expected in outputs.items()
                 if not path.is_file() or path.read_text(encoding='utf-8') != expected]
        if stale:
            raise SystemExit('Generated files are missing or out of date: ' + ', '.join(stale)
                             + '. Run python3 scripts/build.py.')
    else:
        for path, content in outputs.items():
            path.write_text(content, encoding='utf-8')
    print(json.dumps(checks, ensure_ascii=False))


if __name__ == '__main__':
    main()
