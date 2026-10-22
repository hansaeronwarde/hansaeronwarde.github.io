"""Dependency-free structural checks for the buildless portfolio."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Portfolio(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.nodes = []
        self.schema = ''
        self.in_schema = False
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.nodes.append((tag, attrs))
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.in_schema = True

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_schema = False

    def handle_data(self, value):
        if self.in_schema:
            self.schema += value


class Tree(HTMLParser):
    """Elements with their ancestors and text, for checks that depend on nesting."""
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.elements = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        element = {'tag': tag, 'attrs': dict(attrs), 'ancestors': list(self.stack), 'text': '', 'tags': []}
        for open_element in self.stack:
            open_element['tags'].append(element)
        self.elements.append(element)
        if tag not in self.VOID:
            self.stack.append(element)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]['tag'] == tag:
                del self.stack[index:]
                break

    def handle_data(self, value):
        for open_element in self.stack:
            open_element['text'] += value


def classes(element):
    return element['attrs'].get('class', '').split()


def text(element):
    return ' '.join(element['text'].split())


def luminance(hex_colour):
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    high, low = sorted([luminance(a), luminance(b)], reverse=True)
    return (high + 0.05) / (low + 0.05)


class PortfolioTests(unittest.TestCase):
    """The previous home page, kept whole as cases.html: the full case studies the home page links to."""
    canonical = 'https://hansaeronwarde.github.io/cases.html'
    resume_links = 3
    page_file = 'cases.html'

    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / 'cases.html').read_text()
        cls.page = Portfolio(cls.source)
        cls.ids = [attrs['id'] for _, attrs in cls.page.nodes if 'id' in attrs]
        cls.tree = Tree(cls.source)
        cls.css = ''.join((ROOT / 'assets/portfolio' / f).read_text() for f in ['site.css', 'supporting.css'])
        cls.js = (ROOT / 'assets/portfolio/site.js').read_text()

    def test_unique_ids_and_single_identity(self):
        self.assertEqual(len(self.ids), len(set(self.ids)))
        self.assertEqual(sum(tag == 'h1' for tag, _ in self.page.nodes), 1)
        self.assertIn('name', self.ids)

    def test_all_fragment_links_exist(self):
        for tag, attrs in self.page.nodes:
            href = attrs.get('href', '')
            if tag == 'a' and href.startswith('#'):
                with self.subTest(href=href):
                    self.assertIn(unquote(href[1:]), self.ids)

    def test_accessibility_references_exist(self):
        for _, attrs in self.page.nodes:
            for name in ['aria-labelledby', 'aria-describedby', 'aria-controls']:
                for identifier in attrs.get(name, '').split():
                    with self.subTest(attribute=name, identifier=identifier):
                        self.assertIn(identifier, self.ids)

    def test_local_assets_exist_and_no_preview_dependencies(self):
        self.assertNotIn('design-probe/', self.source)
        self.assertNotIn('thoughts/', self.source)
        for tag, attrs in self.page.nodes:
            for name in ['src', 'srcset', 'href']:
                value = attrs.get(name, '')
                if not value or value.startswith('#') or urlsplit(value).scheme:
                    continue
                if tag not in ['script', 'link', 'img', 'source', 'a']:
                    continue
                target = ROOT / unquote(urlsplit(value).path)
                if target.is_dir():
                    target /= 'index.html'
                with self.subTest(tag=tag, path=value):
                    self.assertTrue(target.is_file())

    def test_all_four_cases_are_readable_without_javascript(self):
        panels = [attrs for _, attrs in self.page.nodes if 'data-case-panel' in attrs]
        self.assertEqual([p['id'] for p in panels], ['case-middleware', 'case-activation', 'case-capture', 'case-campaigns'])
        self.assertTrue(all('hidden' not in p for p in panels))

    def test_technical_records_are_valid_and_disclose_their_scope(self):
        records = [e for e in self.tree.elements if 'technical-record' in classes(e)]
        self.assertEqual(len(records), 4)
        for record in records:
            with self.subTest(record=record['attrs']['id']):
                self.assertEqual(record['tag'], 'details')
                self.assertIn('SYNTHETIC RECORD', text(record))
                self.assertIn('RECONSTRUCTED FROM MY PROJECT ACCOUNT', text(record))
                self.assertIn('Client source, production traces and independent benchmark reports are not included.', text(record))
                samples = [e for e in record['tags'] if e['tag'] == 'code']
                self.assertEqual(len(samples), 1)
                self.assertIsInstance(json.loads(samples[0]['text']), dict)

    def test_full_resume_sections_and_credentials(self):
        for identifier in ['resume', 'projects', 'work', 'engineering-focus', 'stack', 'certs', 'education', 'about', 'contact']:
            self.assertIn(identifier, self.ids)
        credentials = [a['href'] for tag, a in self.page.nodes if tag == 'a' and 'credly.com/badges/' in a.get('href', '')]
        self.assertEqual(len(credentials), 4)
        for phrase in ['Cloud Applications Consultant', 'Snap! Mobile', 'Mustache', '$210k', '50,000+', 'Academic and Leadership Excellence', '20+ active integration maps']:
            self.assertIn(phrase, self.source)

    def test_studies_share_one_stylesheet(self):
        # supporting.css loads after site.css with unscoped classes, so a page rule in site.css
        # on one of its classes would reach into the studies. Overrides scoped to .support are deliberate.
        sheets = [a['href'] for tag, a in self.page.nodes if tag == 'link' and a.get('rel') == 'stylesheet']
        self.assertEqual(sheets, ['assets/portfolio/site.css', 'assets/portfolio/supporting.css'])

        def classes(name, scoped=True):
            css = re.sub(r'/\*.*?\*/', '', (ROOT / 'assets/portfolio' / name).read_text(), flags=re.S)
            found = set()
            for rule in re.finditer(r'([^{}]+)\{[^{}]*\}', css):
                for selector in rule.group(1).split(','):
                    if scoped or not selector.strip().startswith('.support'):
                        found |= set(re.findall(r'\.(-?[_a-zA-Z][\w-]*)', selector))
            return found

        self.assertLessEqual(classes('supporting.css') & classes('site.css', scoped=False), {'motion-disabled'})

    def test_scripts_are_local_and_deferred(self):
        scripts = [attrs for tag, attrs in self.page.nodes if tag == 'script' and attrs.get('src')]
        self.assertEqual(len(scripts), 7)
        self.assertTrue(all(a['src'].startswith('assets/portfolio/') and 'defer' in a for a in scripts))

    def test_structured_identity_and_canonical(self):
        schema = json.loads(self.page.schema)
        self.assertEqual(schema['@type'], 'Person')
        self.assertEqual(schema['name'], 'Hans Aeron Warde')
        canonical = [a['href'] for tag, a in self.page.nodes if tag == 'link' and a.get('rel') == 'canonical']
        self.assertEqual(canonical, [self.canonical])

    def test_embedded_asset_provenance(self):
        for asset in ['fonts/Antonio-OFL.txt', 'fonts/Switzer-FFL.txt', 'vendor/LUCIDE-LICENSE', 'media/SOURCES.md', 'media/film-desktop.mp4', 'media/film-mobile.mp4']:
            self.assertTrue((ROOT / 'assets/portfolio' / asset).is_file())

    def test_print_and_reduced_motion_styles_exist(self):
        css = (ROOT / 'assets/portfolio/site.css').read_text()
        self.assertIn('prefers-reduced-motion: reduce', css)
        self.assertIn('@media print', css)
        self.assertIn('.case[hidden]', css)
        self.assertIn('overflow: clip', css)


    def test_named_generic_elements_have_a_role(self):
        # WAI-ARIA 1.2 prohibits naming the generic role; assistive technology drops it.
        for element in self.tree.elements:
            if element['tag'] in ('div', 'span') and 'aria-label' in element['attrs']:
                with self.subTest(label=element['attrs']['aria-label']):
                    self.assertIn('role', element['attrs'])
        for tag in re.findall(r'<(?:div|span)\b[^>]*aria-label[^>]*>', self.js):
            with self.subTest(template=tag):
                self.assertIn('role=', tag)

    def test_time_elements_are_machine_readable(self):
        times = [e for e in self.tree.elements if e['tag'] == 'time']
        self.assertGreaterEqual(len(times), 14)
        for element in times:
            with self.subTest(text=text(element)):
                self.assertRegex(element['attrs'].get('datetime', ''), r'^\d{4}(-\d{2}){0,2}$')

    def test_chapter_names_contain_their_visible_numbers(self):
        controls = [e for e in self.tree.elements if e['tag'] in ('button', 'a')
                    and any('chapter-nav' in classes(a) for a in e['ancestors'])]
        self.assertEqual([text(e) for e in controls], ['00', '01', '02', '03'])
        for element in controls:
            with self.subTest(label=element['attrs'].get('aria-label')):
                self.assertTrue(element['attrs']['aria-label'].startswith(text(element) + ' '))

    def test_site_is_the_resume_and_links_no_pdf(self):
        # Hans ruled on 2026-10-16 that the page is the résumé; the PDF is not published.
        for element in self.tree.elements:
            href = element['attrs'].get('href', '')
            if element['tag'] != 'a':
                continue
            with self.subTest(href=href, text=text(element)):
                self.assertNotRegex(href, r'(?i)\.pdf(?:$|[?#])')
                self.assertNotIn('download', element['attrs'])
                self.assertNotEqual(element['attrs'].get('type'), 'application/pdf')
                if re.search(r'r[eé]sum[eé]', text(element), re.I):
                    self.assertEqual(href, '#resume')
                    self.assertEqual(text(element), 'Résumé' if 'skip' not in classes(element) else 'Skip to résumé')
        resume_links = [e for e in self.tree.elements if e['tag'] == 'a' and e['attrs'].get('href') == '#resume']
        self.assertGreaterEqual(len(resume_links), self.resume_links)
        for name in ('README.md', 'sitemap.xml', 'robots.txt'):
            with self.subTest(file=name):
                self.assertNotIn('resume.pdf', (ROOT / name).read_text())
        self.assertNotIn('resume.pdf', self.page.schema + self.js)

    def test_hero_line_break_never_joins_words(self):
        hero = re.search(r'class="identity-note">(.*?)<div class="identity-links">', self.source, re.S).group(1)
        self.assertIsNone(re.search(r'\S<br', hero))

    def test_type_floor(self):
        self.assertIn('--type-min: 11px;', self.css)
        self.assertIn('--type-link: 12px;', self.css)
        for value in re.findall(r'font(?:-size)?:\s+(\d+(?:\.\d+)?)px', self.css):
            with self.subTest(px=value):
                self.assertGreaterEqual(float(value), 11)
        for value in re.findall(r'font(?:-size)?:\s+(?:\d+ )?(\d+(?:\.\d+)?)pt', self.css):
            with self.subTest(pt=value):
                self.assertGreaterEqual(float(value) * 4 / 3, 11)

    def test_type_sizes_use_the_tokens(self):
        # Raising --type-min or --type-link must move every small label with it.
        literals = re.findall(r'font(?:-size)?:[^;{}]*?\b1[12]px', self.css)
        self.assertEqual(literals, [])

    def test_no_local_home_paths_in_published_text(self):
        # Pages publishes the repo root, tests/ included, so a machine path would ship.
        files = [ROOT / name for name in ('index.html', 'cases.html', 'README.md', 'robots.txt', 'sitemap.xml')]
        files += sorted((ROOT / 'assets/portfolio').glob('*.*'))
        files += sorted((ROOT / 'tests').glob('*.py')) + sorted((ROOT / 'tests').glob('*.mjs')) + sorted((ROOT / 'tests').glob('*.cjs'))
        home = re.compile(r'/(?:Users|home)/[A-Za-z]')
        for path in files:
            with self.subTest(file=str(path.relative_to(ROOT))):
                self.assertIsNone(home.search(path.read_text()))

    def test_selected_case_text_contrast(self):
        rule = re.search(r'\.project-index > a\[aria-current="true"\] \{([^}]*background: (#[0-9a-f]{6})[^}]*)\}', self.css)
        colour = re.search(r'\bcolor: (#[0-9a-f]{6})', rule.group(1))
        self.assertIsNotNone(colour, 'selected case sets no text colour on its tint')
        self.assertGreaterEqual(contrast(colour.group(1), rule.group(2)), 4.5)

    def test_single_link_arrow_pattern(self):
        self.assertRegex(self.css, r'\.arrow-link \{[^}]*gap: var\(--arrow-gap\)')
        for selector in ['.section-label a', '.resume-intro a', '.case-footer a', '.email', '.case-margin a', '.contact-bottom nav a']:
            for body in re.findall(r'(?m)^\s*' + re.escape(selector) + r' \{([^}]*)\}', self.css):
                with self.subTest(selector=selector):
                    self.assertNotIn('gap', body)
        components = ('chapter-nav', 'project-index', 'credential-list', 'career-company')
        for element in self.tree.elements:
            arrow = any(child['tag'] == 'i' and child['attrs'].get('data-lucide', '').startswith('arrow') for child in element['tags'])
            if element['tag'] != 'a' or not arrow or not text(element):
                continue
            chain = element['ancestors'] + [element]
            if any(a['tag'] in ('header', 'h2') or set(classes(a)) & set(components) for a in chain):
                continue
            with self.subTest(link=text(element)):
                self.assertIn('arrow-link', classes(element))

    def test_page_sections_are_not_numbered_like_film_chapters(self):
        for element in self.tree.elements:
            parent = element['ancestors'][-1] if element['ancestors'] else None
            if element['tag'] != 'span' or not parent or 'section-label' not in classes(parent):
                continue
            if any(a['tag'] == 'article' for a in element['ancestors']):
                continue
            with self.subTest(label=text(element)):
                self.assertNotRegex(text(element), r'^\d')
        menu = [e for e in self.tree.elements if e['tag'] == 'small'
                and any(a['attrs'].get('id') == 'site-menu' for a in e['ancestors'])]
        self.assertEqual([text(e) for e in menu], [])

    def test_film_headlines_reach_assistive_technology_once(self):
        for headline in ['Power. Signal.', 'Every request.<br />Tracked.', 'Two systems.']:
            self.assertEqual(self.source.count(headline), 1)
        for element in self.tree.elements:
            if element['tag'] == 'h2' and any('story-line' in classes(a) or 'paper-inner' in classes(a) for a in element['ancestors']):
                with self.subTest(headline=text(element)):
                    self.assertFalse(any(a['attrs'].get('aria-hidden') == 'true' for a in element['ancestors'] + [element]))

    def test_user_visible_copy_has_no_retired_claims(self):
        # Hans's rulings of 2026-10-16: Lead (not Senior), "100k+ active subscribers"
        # (never "concurrent"), dollar figures with no currency code, no Drive links.
        visible = Visible(self.source)
        surfaces = {
            self.page_file: ' '.join(visible.text + visible.attributes),
            'scripts': self.js,
            'css content': ' '.join(re.findall(r'content:\s*"([^"]*)"', self.css)),
            'README.md': (ROOT / 'README.md').read_text(),
            'sitemap.xml': (ROOT / 'sitemap.xml').read_text(),
        }
        retired = {
            'concurrent': r'(?i)concurrent',
            'Google Drive link': r'(?i)(?:drive|docs)\.google\.com',
            'CA$': r'CA\$',
            'CAD': r'\bCAD\b',
            'Senior': r'(?i)\bsenior\b',
        }
        for surface, copy in surfaces.items():
            for name, pattern in retired.items():
                with self.subTest(surface=surface, retired=name):
                    found = re.search(pattern, copy)
                    self.assertIsNone(found, found and found.group(0))
        self.assertIn('100k+ active subscribers', surfaces[self.page_file])


class HomeTests(unittest.TestCase):
    canonical = 'https://hansaeronwarde.github.io/'
    resume_links = 1
    page_file = 'index.html'

    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / 'index.html').read_text()
        cls.page = Portfolio(cls.source)
        cls.ids = [attrs['id'] for _, attrs in cls.page.nodes if 'id' in attrs]
        cls.tree = Tree(cls.source)
        cls.js = ''.join((ROOT / 'assets/portfolio' / f).read_text() for f in ['study.js', 'narrative.js', 'studies.js', 'studies-ui.js'])
        cls.css = ''.join((ROOT / 'assets/portfolio' / f).read_text() for f in ['study.css', 'supporting.css', 'resume.css'])

    test_unique_ids_and_single_identity = PortfolioTests.test_unique_ids_and_single_identity
    test_all_fragment_links_exist = PortfolioTests.test_all_fragment_links_exist
    test_accessibility_references_exist = PortfolioTests.test_accessibility_references_exist
    test_local_assets_exist_and_no_preview_dependencies = PortfolioTests.test_local_assets_exist_and_no_preview_dependencies
    test_structured_identity_and_canonical = PortfolioTests.test_structured_identity_and_canonical
    test_site_is_the_resume_and_links_no_pdf = PortfolioTests.test_site_is_the_resume_and_links_no_pdf
    test_type_floor = PortfolioTests.test_type_floor
    test_type_sizes_use_the_tokens = PortfolioTests.test_type_sizes_use_the_tokens
    test_user_visible_copy_has_no_retired_claims = PortfolioTests.test_user_visible_copy_has_no_retired_claims

    def test_print_and_reduced_motion_styles_exist(self):
        self.assertIn('prefers-reduced-motion: reduce', self.css)
        self.assertIn('@media print', self.css)

    def test_full_resume_sections_and_credentials(self):
        for identifier in ['resume', 'work', 'engineering-focus', 'stack', 'certs', 'education', 'about', 'contact']:
            self.assertIn(identifier, self.ids)
        credentials = [a['href'] for tag, a in self.page.nodes if tag == 'a' and 'credly.com/badges/' in a.get('href', '')]
        self.assertEqual(len(credentials), 4)
        for phrase in ['Cloud Applications Consultant', 'Snap! Mobile', '$210k', '50,000+', 'Academic and Leadership Excellence']:
            self.assertIn(phrase, self.source)

    def test_scripts_are_local_and_deferred(self):
        scripts = [attrs for tag, attrs in self.page.nodes if tag == 'script' and attrs.get('src')]
        self.assertTrue(scripts)
        self.assertTrue(all(a['src'].startswith('assets/portfolio/') and 'defer' in a for a in scripts))

    def test_case_study_links_land_on_a_case(self):
        cases = {attrs['id'] for _, attrs in Portfolio((ROOT / 'cases.html').read_text()).nodes if 'id' in attrs}
        links = [a['href'] for tag, a in self.page.nodes if tag == 'a' and a.get('href', '').startswith('cases.html')]
        self.assertEqual(len(links), 4)
        for href in links:
            with self.subTest(href=href):
                self.assertIn(urlsplit(href).fragment, cases)


class Visible(HTMLParser):
    """Text nodes plus every attribute value: what readers, crawlers and AT can reach."""

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.text = []
        self.attributes = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.attributes.extend(value for _, value in attrs if value)

    def handle_data(self, value):
        self.text.append(value)


if __name__ == '__main__':
    unittest.main()
