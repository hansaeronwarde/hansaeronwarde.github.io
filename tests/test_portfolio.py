"""Dependency-free structural checks for the buildless portfolio."""
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://hansaeronwarde.github.io/'
PAGES = [
    'index.html',
    'cases.html',
    'work/integration-middleware.html',
    'work/sim-activation.html',
    'work/claims-intake.html',
    'work/campaign-delivery.html',
    'notes/bounded-concurrency.html',
    'notes/human-judgment.html',
    'notes/independent-failure.html',
    'notes/legacy-rebuild.html',
]
CASES = ['integration-middleware', 'sim-activation', 'claims-intake', 'campaign-delivery']


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


def classes(element):
    return element['attrs'].get('class', '').split()


def text(element):
    return ' '.join(element['text'].split())


def local(page, value):
    """The repo file a relative URL on `page` points at, with its fragment; None for external URLs."""
    url = urljoin(SITE + page, value)
    if not url.startswith(SITE):
        return None
    parts = urlsplit(url)
    target = ROOT / unquote(parts.path[len(urlsplit(SITE).path):])
    if target.is_dir():
        target /= 'index.html'
    return target, unquote(parts.fragment)


class Page:
    cache = {}

    def __init__(self, name):
        self.name = name
        self.source = (ROOT / name).read_text()
        self.page = Portfolio(self.source)
        self.ids = [attrs['id'] for _, attrs in self.page.nodes if 'id' in attrs]
        self.tree = Tree(self.source)
        self.url = SITE if name == 'index.html' else SITE + name
        self.sheets = [local(name, a['href'])[0] for tag, a in self.page.nodes
                       if tag == 'link' and a.get('rel') == 'stylesheet']
        self.scripts = [local(name, a['src'])[0] for tag, a in self.page.nodes
                        if tag == 'script' and a.get('src')]
        self.css = ''.join(path.read_text() for path in self.sheets)
        self.js = ''.join(path.read_text() for path in self.scripts)

    @classmethod
    def get(cls, name):
        if name not in cls.cache:
            cls.cache[name] = cls(name)
        return cls.cache[name]


def pages():
    return [Page.get(name) for name in PAGES]


def sitemap():
    return re.findall(r'<loc>([^<]+)</loc>', (ROOT / 'sitemap.xml').read_text())


class SiteTests(unittest.TestCase):
    """Every published page: home, the case index, four case studies and four notes."""

    def test_unique_ids_and_single_h1(self):
        for page in pages():
            with self.subTest(page=page.name):
                self.assertEqual(len(page.ids), len(set(page.ids)))
                self.assertEqual(sum(tag == 'h1' for tag, _ in page.page.nodes), 1)

    def test_fragment_links_resolve_on_this_and_other_pages(self):
        for page in pages():
            for tag, attrs in page.page.nodes:
                href = attrs.get('href', '')
                if tag != 'a' or '#' not in href:
                    continue
                target = local(page.name, href)
                if not target or not target[1]:
                    continue
                with self.subTest(page=page.name, href=href):
                    self.assertTrue(target[0].is_file())
                    self.assertIn(target[1], Page.get(str(target[0].relative_to(ROOT))).ids)

    def test_accessibility_references_exist(self):
        for page in pages():
            for _, attrs in page.page.nodes:
                for name in ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for']:
                    for identifier in attrs.get(name, '').split():
                        with self.subTest(page=page.name, attribute=name, identifier=identifier):
                            self.assertIn(identifier, page.ids)

    def test_local_assets_exist_and_no_preview_dependencies(self):
        for page in pages():
            with self.subTest(page=page.name):
                self.assertNotIn('design-probe/', page.source)
                self.assertNotIn('thoughts/', page.source)
            for tag, attrs in page.page.nodes:
                if tag not in ['script', 'link', 'img', 'source', 'a', 'video']:
                    continue
                values = [attrs.get('src', ''), attrs.get('href', ''), attrs.get('poster', '')]
                values += [item.split()[0] for item in attrs.get('srcset', '').split(',') if item.strip()]
                for value in values:
                    if not value or value.startswith('#'):
                        continue
                    target = local(page.name, value)
                    if not target:
                        continue
                    with self.subTest(page=page.name, tag=tag, path=value):
                        self.assertTrue(target[0].is_file())

    def test_scripts_are_local_and_deferred(self):
        for page in pages():
            for tag, attrs in page.page.nodes:
                if tag == 'script' and attrs.get('src'):
                    with self.subTest(page=page.name, src=attrs['src']):
                        self.assertIsNotNone(local(page.name, attrs['src']))
                        self.assertIn('defer', attrs)

    def test_self_canonical_matches_the_sitemap(self):
        listed = sitemap()
        for page in pages():
            canonical = [a['href'] for tag, a in page.page.nodes if tag == 'link' and a.get('rel') == 'canonical']
            with self.subTest(page=page.name):
                self.assertEqual(canonical, [page.url])
                self.assertIn(page.url, listed)

    def test_no_page_is_hidden_from_search(self):
        for page in pages():
            robots = [a.get('content', '') for tag, a in page.page.nodes
                      if tag == 'meta' and a.get('name', '').lower() in ('robots', 'googlebot')]
            with self.subTest(page=page.name):
                self.assertNotIn('noindex', ' '.join(robots).lower())
                self.assertNotRegex(page.source, r'(?i)noindex')

    def test_sitemap_lists_exactly_the_pages(self):
        listed = sitemap()
        self.assertEqual(len(listed), len(set(listed)))
        self.assertEqual(sorted(listed), sorted(page.url for page in pages()))
        self.assertEqual(len(listed), 10)

    def test_structured_data_where_present(self):
        found = 0
        for page in pages():
            if not page.page.schema.strip():
                continue
            found += 1
            with self.subTest(page=page.name):
                schema = json.loads(page.page.schema)
                self.assertEqual(schema['@type'], 'Person')
                self.assertEqual(schema['name'], 'Hans Aeron Warde')
                self.assertEqual(schema['url'], page.url)
        self.assertGreaterEqual(found, 1)

    def test_type_floor(self):
        for page in pages():
            with self.subTest(page=page.name):
                self.assertIn('--type-min: 11px;', page.css)
                self.assertIn('--type-link: 12px;', page.css)
            for value in re.findall(r'font(?:-size)?\s*:[^;{}]*?(\d+(?:\.\d+)?)px', page.css):
                with self.subTest(page=page.name, px=value):
                    self.assertGreaterEqual(float(value), 11)
            for value in re.findall(r'font(?:-size)?\s*:[^;{}]*?(\d+(?:\.\d+)?)pt', page.css):
                with self.subTest(page=page.name, pt=value):
                    self.assertGreaterEqual(float(value) * 4 / 3, 11)

    def test_type_sizes_use_the_tokens(self):
        # Raising --type-min or --type-link must move every small label with it.
        sheets = sorted({path for page in pages() for path in page.sheets})
        for path in sheets:
            css = re.sub(r'/\*.*?\*/', '', path.read_text(), flags=re.S)
            literals = [rule.group(1).strip() for rule in re.finditer(r'([^{}]+)\{([^{}]*)\}', css)
                        if re.search(r'font(?:-size)?:[^;{}]*?\b1[12]px', rule.group(2))]
            name = str(path.relative_to(ROOT))
            with self.subTest(sheet=name):
                self.assertEqual(literals, [])

    def test_print_and_reduced_motion_styles_exist(self):
        for page in pages():
            with self.subTest(page=page.name):
                self.assertIn('prefers-reduced-motion: reduce', page.css)
                self.assertIn('@media print', page.css)

    def test_named_generic_elements_have_a_role(self):
        # WAI-ARIA 1.2 prohibits naming the generic role; assistive technology drops it.
        for page in pages():
            for element in page.tree.elements:
                if element['tag'] in ('div', 'span') and 'aria-label' in element['attrs']:
                    with self.subTest(page=page.name, label=element['attrs']['aria-label']):
                        self.assertIn('role', element['attrs'])
            for tag in re.findall(r'<(?:div|span)\b[^>]*aria-label[^>]*>', page.js):
                with self.subTest(page=page.name, template=tag):
                    self.assertIn('role=', tag)

    def test_time_elements_are_machine_readable(self):
        for page in pages():
            times = [e for e in page.tree.elements if e['tag'] == 'time']
            if page.name == 'index.html':
                self.assertGreaterEqual(len(times), 14)
            for element in times:
                with self.subTest(page=page.name, text=text(element)):
                    value = element['attrs'].get('datetime', '')
                    formats = {4: '%Y', 7: '%Y-%m', 10: '%Y-%m-%d'}
                    self.assertIn(len(value), formats, value)
                    datetime.strptime(value, formats[len(value)])

    def test_site_is_the_resume_and_links_no_pdf(self):
        # Hans ruled on 2026-10-16 that the page is the résumé; the PDF is not published.
        for page in pages():
            resume_links = 0
            for element in page.tree.elements:
                if element['tag'] != 'a':
                    continue
                href = element['attrs'].get('href', '')
                with self.subTest(page=page.name, href=href, text=text(element)):
                    self.assertNotRegex(href, r'(?i)\.pdf(?:$|[?#])')
                    self.assertNotIn('download', element['attrs'])
                    self.assertNotEqual(element['attrs'].get('type'), 'application/pdf')
                    if re.search(r'r[eé]sum[eé]', text(element), re.I):
                        resume_links += 1
                        self.assertEqual(local(page.name, href), (ROOT / 'index.html', 'resume'))
                        self.assertRegex(text(element), r'^(Résumé|Skip to résumé)')
            with self.subTest(page=page.name):
                self.assertGreaterEqual(resume_links, 1)
                self.assertNotIn('resume.pdf', page.page.schema + page.js)
        for name in ('README.md', 'sitemap.xml', 'robots.txt'):
            with self.subTest(file=name):
                self.assertNotIn('resume.pdf', (ROOT / name).read_text())

    def test_conditional_line_breaks_never_join_words(self):
        # A <br class> is hidden at some widths; with no space beside it the words run together.
        for page in pages():
            for match in re.finditer(r'(.)<br\b[^>]*\bclass=[^>]*>(.)', page.source, re.S):
                with self.subTest(page=page.name, at=match.group(0)):
                    self.assertTrue(match.group(1).isspace() or match.group(2).isspace())

    def test_section_labels_are_not_numbered(self):
        for page in pages():
            for element in page.tree.elements:
                parent = element['ancestors'][-1] if element['ancestors'] else None
                if element['tag'] != 'span' or not parent or 'section-label' not in classes(parent):
                    continue
                if any(a['tag'] == 'article' for a in element['ancestors']):
                    continue
                with self.subTest(page=page.name, label=text(element)):
                    self.assertNotRegex(text(element), r'^\d')

    def test_user_visible_copy_has_no_retired_claims(self):
        # Hans's rulings of 2026-10-16: Lead (not Senior), "100k+ active subscribers"
        # (never "concurrent"), dollar figures with no currency code, no Drive links.
        surfaces = {}
        for page in pages():
            visible = Visible(page.source)
            surfaces[page.name] = ' '.join(visible.text + visible.attributes)
            surfaces[f'{page.name} scripts'] = page.js
            surfaces[f'{page.name} css content'] = ' '.join(re.findall(r'content:\s*"([^"]*)"', page.css))
        for name in ('README.md', 'sitemap.xml'):
            surfaces[name] = (ROOT / name).read_text()
        # The N1 note uses "concurrent calls" in its engineering sense; the ruling is about the audience.
        retired = {
            'concurrent': r'(?i)concurrent\s+(?:subscribers|users|customers)|\d+k?\+?\s+concurrent',
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
        for name in ('index.html', 'work/sim-activation.html'):
            with self.subTest(page=name):
                self.assertIn('100k+ active subscribers', surfaces[name])

    def test_no_local_home_paths_in_published_text(self):
        # Pages publishes the repo root, tests/ included, so a machine path would ship.
        files = [ROOT / name for name in PAGES + ['README.md', 'robots.txt', 'sitemap.xml']]
        for pattern in ('*.css', '*.js', 'assets/portfolio/*.*', 'work/*.*', 'notes/*.*', 'tests/*.py', 'tests/*.mjs', 'tests/*.cjs'):
            files += sorted(ROOT.glob(pattern))
        home = re.compile(r'/(?:Users|home)/[A-Za-z]')
        for path in sorted(set(files)):
            if path.suffix in ('.png', '.jpg', '.avif', '.mp4', '.woff2', '.ttf'):
                continue
            with self.subTest(file=str(path.relative_to(ROOT))):
                self.assertIsNone(home.search(path.read_text()))

    def test_embedded_asset_provenance(self):
        for asset in ['fonts/Antonio-OFL.txt', 'fonts/Switzer-FFL.txt', 'vendor/LUCIDE-LICENSE', 'media/SOURCES.md', 'media/film-desktop.mp4', 'media/film-mobile.mp4']:
            with self.subTest(asset=asset):
                self.assertTrue((ROOT / 'assets/portfolio' / asset).is_file())


class HomeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = Page.get('index.html')

    def test_identity(self):
        self.assertIn('name', self.home.ids)

    def test_full_resume_sections_and_credentials(self):
        for identifier in ['resume', 'work', 'engineering-focus', 'stack', 'certs', 'education', 'about', 'contact']:
            self.assertIn(identifier, self.home.ids)
        credentials = [a['href'] for tag, a in self.home.page.nodes if tag == 'a' and 'credly.com/badges/' in a.get('href', '')]
        self.assertEqual(len(credentials), 4)
        for phrase in ['Cloud Applications Consultant', 'Snap! Mobile', '$210k', '50,000+', 'Academic and Leadership Excellence']:
            self.assertIn(phrase, self.home.source)

    def test_work_rows_lead_to_the_case_pages_in_order(self):
        rows = [e['attrs']['href'] for e in self.home.tree.elements
                if e['tag'] == 'a' and any('arrival-index' in classes(a) for a in e['ancestors'])]
        self.assertEqual(rows, [f'work/{case}.html' for case in CASES])


class CaseIndexTests(unittest.TestCase):
    def test_old_case_fragments_still_land_on_their_case(self):
        # Links to the D19 cases.html#case-* still exist in the wild.
        page = Page.get('cases.html')
        rows = [e for e in page.tree.elements if e['tag'] == 'li' and e['attrs'].get('id', '').startswith('case-')]
        self.assertEqual([e['attrs']['id'] for e in rows], ['case-middleware', 'case-activation', 'case-capture', 'case-campaigns'])
        for row, case in zip(rows, CASES):
            with self.subTest(row=row['attrs']['id']):
                self.assertNotIn('hidden', row['attrs'])
                links = [e['attrs']['href'] for e in row['tags'] if e['tag'] == 'a']
                self.assertEqual(links, [f'work/{case}.html'])

    def test_each_case_and_note_is_linked_from_the_site(self):
        linked = set()
        for page in pages():
            for tag, attrs in page.page.nodes:
                target = tag == 'a' and attrs.get('href') and local(page.name, attrs['href'])
                if target:
                    linked.add(str(target[0].relative_to(ROOT)))
        for name in PAGES:
            with self.subTest(page=name):
                self.assertIn(name, linked)


if __name__ == '__main__':
    unittest.main()
