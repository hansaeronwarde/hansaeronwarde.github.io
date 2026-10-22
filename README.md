# Hans Aeron Warde

A buildless personal portfolio for GitHub Pages. The home page (`index.html`) is the approved D19 design: a scroll-controlled film hands one request record into an inspectable study, set in Antonio display type and Switzer body type, followed by a paper-like engineering résumé. `cases.html`, the full case-study page, keeps the earlier D17 design.

## Local Preview

Use an HTTP server with video byte-range support:

```sh
npx --yes http-server@14.1.1 . -p 8080 -c-1
```

Open `http://127.0.0.1:8080/`. No build or framework installation is required. A plain `file://` preview is not a reliable way to test film seeking.

## Source

- `index.html`: the home page. The scroll film follows request 003 through a timeout and retry into its paper record, then the request study, the three supporting studies (telecom, claims, campaigns), the résumé and contact.
- `assets/portfolio/study.css`, `resume.css`: home-page styles.
- `assets/portfolio/supporting.css`: the three supporting studies and the study anatomy (lab bar, transport, register, scope note, footer) on both pages.
- `assets/portfolio/narrative.js`: the film's deterministic snapshots of request 003, built from `queue-model.js`.
- `assets/portfolio/study.js`: film scrubbing, masthead and chapter state, the request study and the motion preference.
- `cases.html`: the full case studies, linked from each study's "Full case study". It is the previous home page, kept whole, styled by `site.css` (plus `supporting.css` for its three studies) and driven by `site.js`.
- `assets/portfolio/studies.js`: synthetic order, claim and campaign models behind the supporting studies, tested independently.
- `assets/portfolio/studies-ui.js`: renders those studies on both pages; the markup carries each one's final record for readers without JavaScript.
- `assets/portfolio/queue-model.js`: deterministic, bounded queue model used by the flagship case and tested independently.
- `assets/portfolio/`: locally hosted fonts, film, posters and vendor scripts. Source credits and licenses are included.

Production does not depend on `design-probe/` or `thoughts/`. The earlier previews remain available separately and are not deployment inputs.

## Behaviour

The rest of this section describes `cases.html`. Each case has a shareable fragment: `cases.html#case-middleware`, `#case-activation`, `#case-capture` and `#case-campaigns`. Back/forward navigation preserves case selection. Without JavaScript all cases remain readable. Print styles include all cases even when the interactive page displays only one.

Device reduced-motion and data-saving preferences bypass the pinned film and video download. The navigation menu offers a persistent reduced-motion preference. `?motion=still` provides an explicit still-image fallback. There is no autoplay audio, scroll hijacking, analytics or third-party runtime script request.

Architecture diagrams are conceptual reconstructions of the supplied case narratives, not client screenshots or live telemetry. Film footage is illustrative stock material, not Hans's client locations.

The film's request trace leads into the batch-processing result (72 h → 4 h), followed by the work index, where each case shows its number, and the case studies. The on-page résumé follows the cases and is reachable from the navigation.

The middleware case has System, Experiment and Trace views. Its synthetic batch model computes FIFO dispatch, downstream capacity rejection, bounded retries with exponential backoff and request history. Visitors can change batch size, workers, capacity and transient errors, inspect any request, download the trace as JSON and view the study source. Time is measured in virtual ticks; it is unrelated to the project's 72 h → 4 h batch-processing result. Reduced motion completes a run immediately and retains single-step controls.

The remaining cases retain two authored scenarios each, presented as independent service lanes, a sample OCR document and branched campaign delivery. These illustrations use no client data. The static architecture and case narratives remain readable without JavaScript.

A five-track graphic mark, shared display typography and ruled layouts connect the work index, case studies, résumé, profile and contact. Each case includes a technical-record disclosure describing its boundary, tradeoff and measurement scope. Supporting study controls expose a sample JSON record that follows the selected scenario and current state. These are explicitly labelled reconstructions, not production evidence; client source, traces and independent benchmark reports are not available in this portfolio.

## Verification

```sh
python3 -m unittest discover -s tests -v
node --check assets/portfolio/site.js assets/portfolio/study.js assets/portfolio/narrative.js assets/portfolio/studies.js assets/portfolio/studies-ui.js assets/portfolio/queue-model.js
node --test tests/*.cjs
npx --yes http-server@14.1.1 . -p 8767 -c-1   # in another terminal
node tests/e2e_portfolio.mjs                  # or: node tests/e2e_portfolio.mjs hits fit
```

The unit tests use only Python's standard library. They check local dependencies, document identifiers, fragment links, accessibility references, semantic cases, resume completeness, structured data, that the two font licences, the Lucide licence and the footage source notes are present (presence only, not their terms), that no type size bypasses the `--type-min` / `--type-link` tokens, and that `site.css` styles none of `supporting.css`'s classes outside its `.support` overrides.

The browser checks in `tests/e2e_portfolio.mjs` drive Google Chrome (the bundled Chromium cannot decode the H.264 film) against the site at `BASE`, default `http://127.0.0.1:8767/`. They run against both pages: film text contrast (on the home page over the video and over the poster alone), the static-mode masthead, the type floor, named capacity sliders in Chrome's accessibility tree, and no horizontal scroll under the WCAG 1.4.12 text-spacing override. The home page also gets hero fit from 320 to 1920 px wide with and without text spacing (the case index unclipped, the masthead on screen, the record card clearing the closing heading), the phone record card staying under the lane numbers it crosses and above the scene footer through the film, the supporting studies keeping their no-JS records if their script fails, and the reader staying in the story when motion is turned off mid-film. The case-study page alone gets lazy film loading, hero link hit-testing, rotation, focus hand-off, the claims connector after a case switch, Back navigation, reflow and the no-JS masthead. The repository has no `package.json`: the script imports `playwright` normally, and if that fails it loads it from `PLAYWRIGHT_FROM`, the path to the `package.json` of any project with Playwright installed:

```sh
PLAYWRIGHT_FROM=/path/to/project/package.json node tests/e2e_portfolio.mjs
```

GitHub Pages publishes the `main` branch from the repository root with its built-in (legacy) build; there is no workflow file and no build step. A push to `main` deploys; local edits alone do not. The on-page résumé is the only résumé; no PDF is published.
