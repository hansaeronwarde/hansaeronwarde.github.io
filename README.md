# Hans Aeron Warde

A buildless personal portfolio for GitHub Pages, set in Antonio display type and Switzer body type. The home page (`index.html`) opens on a scroll-controlled film that hands one request record into an inspectable study. Four case studies and four engineering notes follow, then the résumé, credentials and contact. Each case shows what Hans owned at every layer: UI, services, data, infrastructure, delivery and team.

## Local Preview

Use an HTTP server with video byte-range support:

```sh
npx --yes http-server@14.1.1 . -p 8080 -c-1
```

Open `http://127.0.0.1:8080/`. No build or framework installation is required. A plain `file://` preview is not a reliable way to test film seeking.

## Source

- `index.html`, `d20.css`, `d20.js`, `components.css`: the home page. It has the film, the request study, the principle, previews of three cases, the notes list, career, credentials and the contact band.
- `cases.html`: the selected-work index, with one row per case. It keeps the old `#case-middleware`, `#case-activation`, `#case-capture` and `#case-campaigns` fragments, so earlier links still land on the right case.
- `work/`: one page per case.
  - `integration-middleware.html`, driven by `middleware.js` over `queue-model.js`.
  - `sim-activation.html`, `claims-intake.html` and `campaign-delivery.html`, driven by `assets/portfolio/studies-ui.js` over `studies.js`.
  - All four are styled by `case.css`.
- `notes/`: four engineering notes, each with a small model in `notes.js`.
- `assets/portfolio/study.css`, `supporting.css`, `resume.css`: shared styles.
- `assets/portfolio/study.js`, `narrative.js`, `queue-model.js`: film scrubbing, in-page focus, the request study, and the deterministic queue model behind the film, the middleware case and note N1.
- `assets/portfolio/`: locally hosted fonts, film, AVIF and JPEG posters, and vendor scripts. Source credits and licences are included.

Production does not depend on `design-probe/` or `thoughts/`.

## Behaviour

- **Without JavaScript:** every page stays readable. Each model's markup carries its final record.
- **Motion:** device reduced-motion and data-saving preferences bypass the pinned film and the video download. `?motion=still` gives an explicit still-image fallback.
- **Privacy:** there is no autoplay audio, no analytics and no third-party runtime script request.
- **Not client data:** studies and models are synthetic reconstructions, labelled as such. Film footage is illustrative stock material, not Hans's client locations.

## Verification

```sh
python3 -m unittest discover -s tests -v
node --check d20.js work/middleware.js notes/notes.js assets/portfolio/study.js assets/portfolio/narrative.js assets/portfolio/studies.js assets/portfolio/studies-ui.js assets/portfolio/queue-model.js
node --test tests/*.cjs
npx --yes http-server@14.1.1 . -p 8767 -c-1 -s   # in another terminal
node tests/e2e_portfolio.mjs                     # or: node tests/e2e_portfolio.mjs keyboard labels
```

The unit tests use only Python's standard library and run over all ten published pages: home, `cases.html`, the four `work/` cases and the four `notes/`. On each page they check that local dependencies resolve, ids are unique with one `h1`, fragment links land on an id on this or another page, accessibility references exist, scripts are local and deferred, the type floor holds and small sizes use the `--type-min` / `--type-link` tokens, print and reduced-motion styles exist, and retired claims and PDF links are absent. Each page has a self `rel=canonical` that is in `sitemap.xml`, no page is `noindex`, and the sitemap lists exactly the ten pages. The home page's structured data, résumé sections, credentials and Work rows are checked, and `cases.html` keeps the old `#case-*` fragments, each linking to its case page. The two font licences, the Lucide licence and the footage source notes must be present (presence only, not their terms).

The Node tests cover the queue model, the opening film's snapshots, the three supporting study models, the middleware case's `views()` and `opening()` (`work/middleware.js`), and the note models in `notes/notes.js`: the N1 sweep and its CAP row, N2 statuses, the N3 claim record and the N4 readiness gate. Each also checks that the page's no-JS markup is that model's record, and that `studies-ui.js` does nothing for studies a page does not hold.

The browser checks in `tests/e2e_portfolio.mjs` drive Google Chrome (the bundled Chromium cannot decode the H.264 film) against the site at `BASE`, default `http://127.0.0.1:8767/`. On all ten pages they check layout at six sizes with no console errors, no horizontal scroll under the WCAG 1.4.12 text-spacing override, every Tab stop visible, ringed and unobscured, 2.5.8 target sizes, nothing animating under reduced motion, print, the no-JS state (legible masthead, no ghost text or dead controls), the type floor and 13 px control labels. Case and note pages also get lab Web Vitals and INP on a throttled profile, their no-JS record surviving a failed model script, the study focus hand-offs, named sliders, the N1 CAP row and N4 gate, and code blocks that wrap instead of scrolling sideways in both Chrome and WebKit. The home page keeps its film checks (text contrast over the video and over the poster alone, hero fit from 320 to 1920 px wide with and without text spacing, the phone record card through the film, motion off mid-film, rotation, no film bytes before the first scroll), plus its Work rows, jump-link focus into the previews and the contact band. The repository has no `package.json`: the script imports `playwright` normally, and if that fails it loads it from `PLAYWRIGHT_FROM`, the path to the `package.json` of any project with Playwright and its Chrome and WebKit browsers installed:

```sh
PLAYWRIGHT_FROM=/path/to/project/package.json node tests/e2e_portfolio.mjs
```

GitHub Pages publishes the `main` branch from the repository root with its built-in (legacy) build; there is no workflow file and no build step. A push to `main` deploys; local edits alone do not. The on-page résumé is the only résumé; no PDF is published.
