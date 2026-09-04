import copy
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hengshu_build', ROOT / 'scripts' / 'build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class CollectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.canonical = json.loads((ROOT / 'poems' / 'poems.json').read_text(encoding='utf-8'))

    def setUp(self):
        self.data = copy.deepcopy(self.canonical)

    def poem(self, poem_id):
        return next(p for p in self.data['poems'] if p['id'] == poem_id)

    def test_generated_documents_match_canonical_data(self):
        _, outputs = build.generated_outputs(self.data)
        self.assertFalse(any(path.parent == ROOT / 'poems' for path in outputs))
        for path, expected in outputs.items():
            with self.subTest(path=path.name):
                self.assertEqual(path.read_text(encoding='utf-8'), expected)

    def test_readme_prose_does_not_affect_grid_validation(self):
        current = (ROOT / 'README.md').read_text(encoding='utf-8')
        edited = '# A hand-edited introduction\n\n' + current + '\nA different process summary.\n'
        build.validate_readme(self.data, edited)

    def test_rejects_readme_grid_drift(self):
        current = (ROOT / 'README.md').read_text(encoding='utf-8')
        original = ' '.join(self.poem('P02')['rows'][0])
        edited = current.replace(original, '人 去 旧 柳 寒', 1)
        with self.assertRaisesRegex(ValueError, 'README poem grids differ'):
            build.validate_readme(self.data, edited)

    def test_public_editions_preserve_grids_and_complete_coverage(self):
        _, outputs = build.generated_outputs(self.data)

        def grids(document):
            return [tuple(''.join(line.split()) for line in block.splitlines())
                    for block in re.findall(r'```text\n(.*?)\n```', document, re.S)]

        complete = grids(outputs[ROOT / 'more_poems.md'])
        featured = grids((ROOT / 'README.md').read_text(encoding='utf-8'))
        self.assertEqual(Counter(complete), Counter(tuple(p['rows']) for p in self.data['poems']))
        self.assertEqual(len(featured), 7)
        self.assertEqual(len(set(featured)), len(featured))
        self.assertTrue(set(featured).issubset(complete))

    def test_poem_images_are_embedded_in_reading_editions(self):
        _, outputs = build.generated_outputs(self.data)
        readme = (ROOT / 'README.md').read_text(encoding='utf-8')
        complete = outputs[ROOT / 'more_poems.md']
        for p in self.data['poems']:
            with self.subTest(poem=p['id'], edition='complete'):
                title = f'《{p["title"]}》'
                heading_and_image = f'### {title}\n\n![{title}：诗歌方阵、英文翻译与阅读方向]({p["imageUrl"]})'
                self.assertIn(heading_and_image, complete)
                self.assertEqual(complete.count(p['imageUrl']), 1)
        for _, _, poems in build.public_selection(self.data):
            for p in poems:
                with self.subTest(poem=p['id']):
                    title = f'《{p["title"]}》'
                    heading_and_image = f'### {title}\n\n![{title}：诗歌方阵、英文翻译与阅读方向]({p["imageUrl"]})'
                    self.assertIn(heading_and_image + '\n\n' + build.grid_markdown(p), readme)

    def test_full_edition_has_no_intro_or_navigation_boilerplate(self):
        complete = build.more_poems_markdown(self.data)
        self.assertTrue(complete.startswith('# More poems · 全集\n\n## Rhyming pairs\n'))
        self.assertTrue(complete.endswith('</details>\n'))
        self.assertNotIn('Featured in README', complete)

    def test_symmetric_four_direction_grid_keeps_backward_readings(self):
        poem = {'id': 'NEW', 'title': '测试', 'collection': 'four_direction',
                'rows': self.poem('S01')['rows']}
        report = build.validate_poem(poem)
        self.assertTrue(report['transposeSymmetric'])
        document = build.more_poems_markdown({'poems': [poem]})
        self.assertIn('Readings: → / ↓ / ← / ↑', document)
        self.assertIn(report['readings']['left'][0], document)

    def test_rejects_missing_or_invalid_image_urls(self):
        for pid in ('P02', 'P01'):
            for url in (None, 'poems/image.md', 'https://example.com/image.png'):
                with self.subTest(poem=pid, url=url):
                    original = self.poem(pid)['imageUrl']
                    self.poem(pid)['imageUrl'] = url
                    with self.assertRaisesRegex(ValueError, 'invalid GitHub image URL'):
                        build.validate(self.data)
                    self.poem(pid)['imageUrl'] = original

    def test_poem_card_requires_translation_source(self):
        del self.poem('F02')['english']
        with self.assertRaisesRegex(ValueError, 'F02: poem card requires English translations'):
            build.validate(self.data)

    def test_rejects_missing_or_empty_english_lines(self):
        p = self.poem('N04')
        raw = build.readings(p)['up'][0]
        original = p['english']['lines'].pop(raw)
        with self.assertRaisesRegex(ValueError, 'English lines do not match'):
            build.validate(self.data)
        p['english']['lines'][raw] = ''
        with self.assertRaisesRegex(ValueError, 'empty or multiline English'):
            build.validate(self.data)
        p['english']['lines'][raw] = original

    def test_rejects_unsafe_or_duplicate_export_slugs(self):
        p = self.poem('P02')
        p['english']['slug'] = '../README'
        with self.assertRaisesRegex(ValueError, 'invalid export slug'):
            build.validate(self.data)
        p['english']['slug'] = self.poem('R01')['english']['slug']
        with self.assertRaisesRegex(ValueError, 'Duplicate export slug'):
            build.validate(self.data)

    def test_rejects_missing_character(self):
        self.poem('P02')['rows'][0] = '人归旧柳'
        with self.assertRaises(ValueError):
            build.validate(self.data)

    def test_computes_four_directions_without_stored_readings(self):
        draft = {'collection': 'four_direction', 'rows': self.poem('F02')['rows']}
        report = build.validate_poem(draft)
        self.assertEqual(report['readings']['down'],
                         ['我听你等风', '等雨问风听', '你听不问我', '问山听雨等', '风问我等你'])
        self.assertEqual(report['readings']['left'],
                         ['风问你等我', '问山听雨听', '我听不问你', '等雨问风等', '你等我听风'])
        self.assertEqual(report['readings']['up'],
                         ['风等你听我', '听风问雨等', '我问不听你', '等雨听山问', '你等我问风'])
        self.assertEqual(report['distinctSupported'], 20)

    def test_rejects_punctuation_that_changes_text(self):
        self.poem('P03')['punctuation']['right'][0] = '相对才念旧，'
        with self.assertRaisesRegex(ValueError, 'punctuation changed grid characters'):
            build.validate(self.data)

    def test_rejects_wrong_rhyme_family(self):
        self.poem('P02')['rhyme']['family'] = '十欧'
        with self.assertRaises(ValueError):
            build.validate(self.data)

    def test_rejects_wrong_contextual_pronunciation(self):
        self.poem('R02')['rhyme']['across'][-1] = 'hái'
        with self.assertRaises(ValueError):
            build.validate(self.data)

    def test_conditional_rhyme_cannot_enter_selection(self):
        self.poem('N02')['status'] = 'Selected'
        with self.assertRaises(ValueError):
            build.generated_outputs(self.data)

    def test_draft_cli_needs_no_collection_or_publication_metadata(self):
        before = (ROOT / 'poems' / 'poems.json').read_bytes()
        for pid in ('R01', 'S01'):
            poem = self.poem(pid)
            draft = {key: poem[key] for key in ('collection', 'rows', 'rhyme') if key in poem}
            with self.subTest(poem=pid), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'draft.json'
                path.write_text(json.dumps(draft, ensure_ascii=False), encoding='utf-8')
                result = subprocess.run([sys.executable, str(ROOT / 'scripts' / 'build.py'),
                                         '--draft', str(path)], cwd=directory,
                                        text=True, capture_output=True, check=True)
                report = json.loads(result.stdout)
                self.assertEqual(report['readings']['right'], poem['rows'])
                self.assertEqual(report['transposeSymmetric'], pid == 'S01')
        self.assertEqual((ROOT / 'poems' / 'poems.json').read_bytes(), before)

    def test_draft_checks_form_and_declared_directions(self):
        draft = {'collection': 'same_poem_square', 'rows': self.poem('S01')['rows']}
        draft['directions'] = ['right']
        with self.assertRaisesRegex(ValueError, 'incorrect directions'):
            build.validate_poem(draft)
        del draft['directions']
        draft['rows'] = self.poem('R01')['rows']
        with self.assertRaisesRegex(ValueError, 'not symmetric'):
            build.validate_poem(draft)

    def test_rhyme_checks_can_use_an_additional_reviewed_reading(self):
        poem = self.poem('N01')
        draft = {key: poem[key] for key in ('collection', 'rows', 'rhyme')}
        draft['rhyme']['across'][2] = 'huǎng'
        with self.assertRaisesRegex(ValueError, 'unreviewed pronunciation'):
            build.validate_poem(draft)
        reference = copy.deepcopy(build.RHYMES)
        reference['readings']['晃'].append({'pinyin': 'huǎng', 'final': 'uang'})
        self.assertEqual(build.validate_poem(draft, reference)['rhyme'], 'pass')

    def test_conditional_reading_cannot_be_relabelled_as_strict(self):
        self.poem('N02')['rhyme']['compliance'] = 'pass'
        with self.assertRaisesRegex(ValueError, 'conditional pronunciation'):
            build.validate(self.data)

    def test_local_markdown_links_resolve(self):
        for document in [*ROOT.glob('*.md'), *(ROOT / 'docs').rglob('*.md')]:
            text = document.read_text(encoding='utf-8')
            for target in re.findall(r'\]\(([^\s)]+)\)', text):
                if '://' in target or target.startswith(('#', 'mailto:')):
                    continue
                target = unquote(target.split('#', 1)[0].strip('<>'))
                with self.subTest(document=str(document.relative_to(ROOT)), target=target):
                    self.assertTrue((document.parent / target).exists())


if __name__ == '__main__':
    unittest.main()
