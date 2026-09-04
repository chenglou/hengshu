import copy
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
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
        with self.assertRaisesRegex(AssertionError, 'README poem grids differ'):
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

    def test_rejects_missing_or_invalid_image_urls(self):
        for url in (None, 'poems/gui-qu.md', 'https://example.com/image.png'):
            with self.subTest(url=url):
                self.poem('P02')['imageUrl'] = url
                with self.assertRaisesRegex(AssertionError, 'Featured poem requires a GitHub image URL'):
                    build.public_selection(self.data)
        self.poem('P02')['imageUrl'] = next(p['imageUrl'] for p in self.canonical['poems'] if p['id'] == 'P02')
        for url in (None, 'poems/liu-yin.md', 'https://example.com/image.png'):
            with self.subTest(poem='P01', url=url):
                self.poem('P01')['imageUrl'] = url
                with self.assertRaisesRegex(AssertionError, 'Invalid GitHub image URL: P01'):
                    build.validate(self.data)

    def test_poem_card_requires_translation_source(self):
        del self.poem('F02')['english']
        with self.assertRaisesRegex(AssertionError, 'Poem card requires English translations: F02'):
            build.validate(self.data)

    def test_rejects_missing_or_empty_english_lines(self):
        p = self.poem('N04')
        raw = p['readings']['up'][0]
        original = p['english']['lines'].pop(raw)
        with self.assertRaisesRegex(AssertionError, 'English lines do not match'):
            build.validate(self.data)
        p['english']['lines'][raw] = ''
        with self.assertRaisesRegex(AssertionError, 'Empty or multiline English'):
            build.validate(self.data)
        p['english']['lines'][raw] = original

    def test_rejects_unsafe_or_duplicate_export_slugs(self):
        p = self.poem('P02')
        p['english']['slug'] = '../README'
        with self.assertRaisesRegex(AssertionError, 'Invalid export slug'):
            build.validate(self.data)
        p['english']['slug'] = self.poem('R01')['english']['slug']
        with self.assertRaisesRegex(AssertionError, 'Duplicate export slug'):
            build.validate(self.data)

    def test_rejects_missing_character(self):
        self.poem('P02')['rows'][0] = '人归旧柳'
        with self.assertRaises(AssertionError):
            build.validate(self.data)

    def test_rejects_incorrect_transpose(self):
        self.poem('P02')['readings']['down'][0] = '人归旧柳寒'
        with self.assertRaisesRegex(AssertionError, 'Reading mismatch'):
            build.validate(self.data)

    def test_rejects_punctuation_that_changes_text(self):
        self.poem('P03')['punctuation']['right'][0] = '相对才念旧，'
        with self.assertRaisesRegex(AssertionError, 'Punctuation changed letters'):
            build.validate(self.data)

    def test_rejects_wrong_rhyme_family(self):
        self.poem('P02')['rhyme']['family'] = '十欧'
        with self.assertRaises(AssertionError):
            build.validate(self.data)

    def test_rejects_wrong_contextual_pronunciation(self):
        self.poem('R02')['rhyme']['across'][-1] = 'hái'
        with self.assertRaises(AssertionError):
            build.validate(self.data)

    def test_conditional_rhyme_cannot_enter_selection(self):
        self.poem('N02')['status'] = 'Selected'
        with self.assertRaises(AssertionError):
            build.generated_outputs(self.data)

    def test_preserved_source_cannot_be_silently_rewritten(self):
        p = self.poem('R01')
        p['rows'][0] = '孤帆过渚晚'
        p['readings']['right'][0] = p['rows'][0]
        p['readings']['down'][0] = '孤舟客梦寒'
        with self.assertRaisesRegex(AssertionError, 'Earlier wording altered'):
            build.validate(self.data)

    def test_local_markdown_links_resolve(self):
        for document in ROOT.rglob('*.md'):
            text = document.read_text(encoding='utf-8')
            for target in re.findall(r'\]\(([^\s)]+)\)', text):
                if '://' in target or target.startswith(('#', 'mailto:')):
                    continue
                target = unquote(target.split('#', 1)[0].strip('<>'))
                with self.subTest(document=str(document.relative_to(ROOT)), target=target):
                    self.assertTrue((document.parent / target).exists())


if __name__ == '__main__':
    unittest.main()
