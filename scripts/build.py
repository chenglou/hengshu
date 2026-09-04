"""Check poem drafts and rebuild the full reading edition (standard library only)."""
from pathlib import Path
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'poems' / 'poems.json'
RHYMES = json.loads((ROOT / 'poems' / 'rhymes.json').read_text(encoding='utf-8'))
HAN = re.compile(r'[\u4e00-\u9fff]')
GITHUB_IMAGE_URL = re.compile(r'https://github\.com/user-attachments/assets/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')
ARROWS = {'right': '→', 'down': '↓', 'left': '←', 'up': '↑'}
FORMS = {
    'rhyming_pair': ['right', 'down'],
    'same_poem_square': ['right', 'down'],
    'four_direction': ['right', 'down', 'left', 'up'],
    'unrhymed_pair': ['right', 'down'],
}
PALETTES = {'beige', 'green', 'rose', 'blue', 'sage', 'plum'}
PUBLIC_GROUPS = (
    ('rhyming_pair', 'Rhyming pairs', '→ and ↓ produce different poems; both rhyme.',
     ('P02', 'R01', 'P03')),
    ('same_poem_square', 'Symmetric squares', '→ and ↓ produce the same poem.',
     ('N05', 'S01', 'S02')),
    ('four_direction', 'Omnidirectional poem', 'Readable in all → ↓ ← ↑ directions.',
     ('N04',)),
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def valid_grid(rows):
    return (isinstance(rows, list) and len(rows) == 5
            and all(isinstance(row, str) and len(row) == 5
                    and len(HAN.findall(row)) == 5 for row in rows))


def readings(poem):
    rows = poem['rows']
    columns = [''.join(row[index] for row in rows) for index in range(5)]
    all_readings = {'right': rows, 'down': columns,
                    'left': [row[::-1] for row in rows],
                    'up': [column[::-1] for column in columns]}
    return {direction: all_readings[direction]
            for direction in poem.get('directions', FORMS[poem['collection']])}


def validate_poem(poem, rhyme_reference=None):
    """A draft needs only its form, grid, and (for rhyming pairs) rhyme claims."""
    require(isinstance(poem, dict), 'A draft must be one poem object')
    name = str(poem.get('id', 'Draft'))
    form = poem.get('collection')
    require(isinstance(form, str) and form in FORMS, name + ': unknown collection/form')
    require(valid_grid(poem.get('rows')), name + ': expected a 5×5 Chinese-character grid')
    require(poem.get('directions', FORMS[form]) == FORMS[form], name + ': incorrect directions for form')
    expected = readings(poem)
    rows, columns = expected['right'], expected['down']
    symmetric = rows == columns
    require(form != 'same_poem_square' or symmetric, name + ': square is not symmetric')
    require(form not in ('rhyming_pair', 'unrhymed_pair') or not symmetric,
            name + ': poem-pair readings must differ')
    status = poem.get('status', 'Workshop')
    require(status in ('Selected', 'Reserve', 'Workshop'), name + ': invalid status')
    punctuation = poem.get('punctuation', {})
    require(isinstance(punctuation, dict), name + ': punctuation must map directions to lines')
    for direction, lines in punctuation.items():
        require(direction in expected and isinstance(lines, list) and len(lines) == 5
                and all(isinstance(line, str) for line in lines), name + ': invalid punctuated reading')
        require([''.join(HAN.findall(line)) for line in lines] == expected[direction],
                name + ': punctuation changed grid characters')
    if 'originalRows' in poem:
        require(valid_grid(poem['originalRows']), name + ': invalid original grid')

    rhyme = poem.get('rhyme')
    require(form != 'rhyming_pair' or isinstance(rhyme, dict), name + ': rhyming pair requires rhyme metadata')
    if rhyme is not None:
        require(isinstance(rhyme, dict), name + ': invalid rhyme metadata')
        reference = RHYMES if rhyme_reference is None else rhyme_reference
        family = rhyme.get('family')
        require(isinstance(family, str) and family in reference['families'], name + ': unreviewed rhyme family')
        compliance = rhyme.get('compliance')
        require(compliance in ('pass', 'conditional'), name + ': invalid rhyme compliance')
        for direction, key in (('right', 'across'), ('down', 'down')):
            pinyin = rhyme.get(key)
            require(isinstance(pinyin, list) and len(pinyin) == 5, name + ': five rhyme pronunciations required')
            for line, pronunciation in zip(expected[direction], pinyin):
                character = line[-1]
                matches = [item for item in reference['readings'].get(character, [])
                           if item['pinyin'] == pronunciation]
                require(len(matches) == 1, name + ': unreviewed pronunciation for ' + character
                        + '; check its context and update poems/rhymes.json')
                reading = matches[0]
                require(reading['final'] in reference['families'][family], name + ': ending outside rhyme family')
                require(not reading.get('conditional') or compliance == 'conditional',
                        name + ': conditional pronunciation cannot pass strict rhyme')
        if compliance == 'conditional':
            require(isinstance(rhyme.get('caveat'), str) and rhyme['caveat'].strip(), name + ': conditional rhyme needs a caveat')
        require(form != 'rhyming_pair' or status != 'Selected' or compliance == 'pass',
                name + ': selected rhyming pair must pass')

    english = poem.get('english')
    if english is not None:
        require(isinstance(english, dict), name + ': invalid English translations')
        slug = english.get('slug')
        require(isinstance(slug, str) and re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug), name + ': invalid export slug')
        require(isinstance(english.get('title'), str) and english['title'].strip(), name + ': missing English title')
        lines = english.get('lines')
        source_lines = {line for group in expected.values() for line in group}
        require(isinstance(lines, dict) and set(lines) == source_lines, name + ': English lines do not match supported readings')
        require(all(isinstance(line, str) and line.strip() and '\n' not in line and '\r' not in line
                    for line in lines.values()), name + ': empty or multiline English translation')
    if 'palette' in poem:
        require(isinstance(poem['palette'], str) and poem['palette'] in PALETTES, name + ': invalid palette')
    if 'imageUrl' in poem:
        require(isinstance(poem['imageUrl'], str) and GITHUB_IMAGE_URL.fullmatch(poem['imageUrl']), name + ': invalid GitHub image URL')
        require(english is not None, name + ': poem card requires English translations')
    return {'readings': expected, 'transposeSymmetric': symmetric,
            'rotationSymmetric': rows == [row[::-1] for row in rows[::-1]],
            'distinctForward': len(set(rows + columns)),
            'distinctSupported': len({line for group in expected.values() for line in group}),
            'rhyme': rhyme['compliance'] if rhyme else 'not claimed'}


def validate(data):
    require(isinstance(data, dict) and isinstance(data.get('poems'), list), 'Expected a poems list')
    ids, slugs, reports = [], [], []
    for poem in data['poems']:
        require(isinstance(poem, dict), 'Expected a poem object')
        for field in ('id', 'title'):
            require(isinstance(poem.get(field), str) and poem[field].strip(), 'Missing poem ' + field)
        ids.append(poem['id'])
        reports.append(validate_poem(poem))
        if poem.get('english'):
            slugs.append(poem['english']['slug'])
    require(len(ids) == len(set(ids)), 'Duplicate poem ID')
    require(len(slugs) == len(set(slugs)), 'Duplicate export slug')
    return {'entries': len(ids), 'dimensionsAndReadings': 'pass',
            'strictRhymePairs': sum(p['collection'] == 'rhyming_pair' and r['rhyme'] == 'pass'
                                    for p, r in zip(data['poems'], reports)),
            'conditionalRhymePairs': sum(r['rhyme'] == 'conditional' for r in reports)}


def grid_markdown(poem):
    return '```text\n' + '\n'.join(' '.join(row) for row in poem['rows']) + '\n```'


def public_selection(data):
    by_id = {poem['id']: poem for poem in data['poems']}
    groups = []
    for collection, title, description, ids in PUBLIC_GROUPS:
        require(all(pid in by_id for pid in ids), 'Missing README selection')
        poems = [by_id[pid] for pid in ids]
        for poem in poems:
            require(poem['collection'] == collection and poem.get('status') == 'Selected', 'Invalid README selection: ' + poem['id'])
            require(poem.get('english') and poem.get('imageUrl'), 'Featured poem requires translations and an image URL')
        groups.append((title, description, poems))
    return groups


def validate_readme(data, current):
    expected = [tuple(poem['rows']) for _, _, poems in public_selection(data) for poem in poems]
    actual = [tuple(''.join(line.split()) for line in block.splitlines())
              for block in re.findall(r'```text\n(.*?)\n```', current, re.S)]
    require(actual == expected, 'README poem grids differ from the featured selection; update README.md manually')


def more_poems_markdown(data):
    groups = [(collection, title, description) for collection, title, description, _ in PUBLIC_GROUPS]
    groups[2] = ('four_direction', 'Omnidirectional poems', groups[2][2])
    groups.append(('unrhymed_pair', 'Unrhymed pairs', '→ and ↓ produce different poems; rhyme is not required.'))
    out = ['# More poems · 全集']
    for collection, title, description in groups:
        out.extend(['## ' + title, description])
        for poem in data['poems']:
            if poem['collection'] != collection:
                continue
            raw = readings(poem)
            symmetric = poem['collection'] == 'same_poem_square'
            labels = [poem.get('status', 'Workshop')]
            rhyme = poem.get('rhyme')
            if rhyme:
                labels.append(rhyme['family'])
                if rhyme['compliance'] == 'conditional':
                    labels.append('Conditional rhyme')
            title = f'《{poem["title"]}》'
            out.append('### ' + title)
            if poem.get('imageUrl'):
                out.append(f'![{title}：诗歌方阵、英文翻译与阅读方向]({poem["imageUrl"]})')
            out.extend([' · '.join(labels), grid_markdown(poem)])
            directions = ['right'] if symmetric else list(raw)
            headers = ['→ = ↓'] if symmetric else [ARROWS[d] for d in directions]
            lines = [poem.get('punctuation', {}).get(d, raw[d]) for d in directions]
            table = ['| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join('---' for _ in headers) + ' |']
            table.extend('| ' + ' | '.join(row) + ' |' for row in zip(*lines))
            expanded = ['\n'.join(table)]
            if rhyme:
                for direction, key in (('right', 'across'), ('down', 'down')):
                    endings = [line[-1] + ' ' + pinyin for line, pinyin in zip(raw[direction], rhyme[key])]
                    expanded.append('**' + ARROWS[direction] + ' rhyme endings:** ' + ' · '.join(endings))
            out.append('<details>\n<summary>Readings: ' + ' / '.join(headers) + '</summary>\n\n'
                       + '\n\n'.join(expanded) + '\n\n</details>')
    return '\n\n'.join(out) + '\n'


def generated_outputs(data):
    checks = validate(data)
    validate_readme(data, (ROOT / 'README.md').read_text(encoding='utf-8'))
    return checks, {ROOT / 'more_poems.md': more_poems_markdown(data)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Check generated Markdown without writing it')
    mode.add_argument('--draft', type=Path, help='Check one draft JSON file and print its computed readings')
    args = parser.parse_args()
    try:
        if args.draft:
            poem = json.loads(args.draft.read_text(encoding='utf-8'))
            print(json.dumps(validate_poem(poem), ensure_ascii=False, indent=2))
            return
        data = json.loads(DATA.read_text(encoding='utf-8'))
        checks, outputs = generated_outputs(data)
        for path, content in outputs.items():
            if args.check:
                require(path.exists() and path.read_text(encoding='utf-8') == content,
                        'Generated file is stale: ' + str(path.relative_to(ROOT)) + '; run python3 scripts/build.py')
            else:
                path.write_text(content, encoding='utf-8')
        print(json.dumps(checks, ensure_ascii=False))
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
