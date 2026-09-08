# UI implementation and verification report

Task: `task_d73da263a4c2` · Dispatch: `ctx_81a879b8b98d` · 2026-09-08

## Delivered

- Korean local workspace with responsive neutral/sidebar/teal design, original CSS paper/leaf/orbit artwork, keyboard focus styles, a skip link, empty/error/loading states, bootstrap login and session locking.
- Library API-backed listing/search/read-status filters, grid/list display, PDF picker and relative-path import, folder scan, title/DOI/tags/status editing, archive and restore. Unlinked metadata records explicitly display `원문 미연결`; no fabricated PDF or papers are supplied by the client.
- Actual PDF.js 6 canvas and selectable text layer, authenticated local PDF URL, local worker/fonts/CMaps/WASM, page controls, zoom, saved reading position, selection-based highlights and notes. Controls wait for saved state and PDF page count; successful position saves have feedback.
- Translation page/segment scope, explicit `use`/`refresh` requests, cache reads, job polling/cancellation, provider attribution, summary and chat panels, and notes. GETs/navigation do not issue generation calls. The server's unavailable/configuration/error states remain visible.
- Safe Markdown Wiki creation, editing, preview, archive and restore; raw HTML/scripts are not executed. Wiki links from lessons resolve by the selected document ID.
- Dynamic six-kind lesson block validation/rendering/editing, actual paper/Wiki pickers, curriculum and lesson CRUD, resource creation/link roles, ordering, prerequisite relationships, archive/restore, and safe read-only handling of unknown block kinds/schema versions.
- Revision-bound study time/reflection, exercise environment/method/evidence/commit/results, self-explanation answers, checklist block responses, explicit completion confirmation, review dates, and previous-version records.
- Configuration with local/paid tabs, provider/model/default selection, metadata-only connection action, local isolation acknowledgment reset on endpoint change, network permissions and limits, write-only credential save/delete, read-only access-token issuance and revocation. No secrets are stored in browser storage or test artifacts.

## Verification

- `npm run typecheck`: passed on the integrated checkout.
- `npm test -- tests/ui-helpers.test.ts`: **10 passed**. Includes UTF-16 surrogate boundaries, exact identity/hash/extraction/page/item validation, refusal of many-to-many normalization assumptions, rotated rectangle transforms and browser-offset inverse mapping, all six block kinds, unknown schema preservation, payload rejection, and immutable ordering.
- `npx playwright test tests/ui-workspace.spec.ts --workers=1 --reporter=line`: **8 passed in 7.4 seconds** on the coordinator's live `http://127.0.0.1:3000`, using actual PostgreSQL and the real imported public PDF. Subsequent last-mile UserUnit scaling adjustment is a CSS scale input change; the primary tested fixture has UserUnit 1.
- Browser tests cover bootstrap password input, real library retrieval/filtering/import picker, Wiki create/edit and script rejection, dynamic lesson creation, actual study and exercise writes, manual completion, persisted checklist response, a new content version retaining prior records, curriculum archive/restore, provider tabs with safe policies/write-only inputs, and mobile overflow/non-overlap.
- The PDF browser test selects the actual text `Trace-based`, saves source UTF-16 range `[0,11)`, checks the exact paper revision and a 64-character source hash, verifies the stored highlight width and height scale by 1.5 at 150% zoom, and verifies page/scale survive a reload. It archives only its newly created annotation afterward.
- Browser request assertions verify **zero generation POSTs** during library/reader navigation, selection and annotation work. No external model/translation requests, paid calls, API-key provisioning, credential writes, provider enabling, or network-policy enabling were performed.
- Browser QA records use `UI QA` names; successful runs archive their own Wiki/curriculum fixtures. Earlier UI-only QA records were also archived. Original PDF bytes and seeded learning data were preserved.

The real-browser suite exposed PostgreSQL JSONB double-serialization affecting metadata and Wiki PATCH; the backend owner repaired it and the suite subsequently passed. Visual inspection caught PDF.js's generic `.sidebar` minimum width overriding the mobile layout; a scoped reset and a non-overlap assertion now cover that regression. Repeated PDF testing also caught the saved-state/page-count initialization race; reader controls now wait until their inputs are available and the test waits for the save response before reload.

## Screenshots

Screenshots are gitignored, contain no credentials, and were framed at page top with nonessential focus removed:

- `test-results/ui/login.png`
- `test-results/ui/library.png`
- `test-results/ui/wiki.png`
- `test-results/ui/curriculum.png`
- `test-results/ui/settings.png`
- `test-results/ui/mobile-library.png`
- `test-results/ui/reader-highlight.png`

## Explicit limits

- **No claim of word alignment.** Translation-word hover is explicitly unavailable. A verified substring selection inside one identical PDF.js TextItem is supported; it is not a replacement for source/target word alignment. Multi-item normalized selections are rejected with an explanation. Stored overlays require the current PDF revision, extraction namespace, source hash/range, and live browser TextItem hashes to match. Rotated coordinate helpers are tested; broad real-PDF rotation/ligature/multi-column/UserUnit corpora are not certified.
- Durable branched chat is still `NOT_IMPLEMENTED` in the backend. The chat panel displays server failure honestly; it does not synthesize a conversation or successful answer.
- Translation/summary cache and explicit generation controls are wired, but successful live provider generation, translation quality, attribution branding beyond supplied text, and model streaming were not exercised in this worker run. No real credential destination was provisioned.
- The client exposes note/highlight creation and viewing; inline editing/archiving of existing annotations, Wiki revision comparison, historical lesson snapshot inspection, and study/submission editing remain later UI work. Existing records and version identity are shown.
- Configuration creates no custom provider instance from this UI; existing configured instances can be edited. Interface language remains Korean; the language setting is not a complete English localization. Display-name/time-zone preferences are stored by configuration, while the shell name and date formatting are not fully personalized.
- Production build, Docker verification, MCP, backend/domain tests, and root dependency/Git management remain coordinator-owned and are not claimed by this report.

## Exact edited files

```text
apps/web/src/app/layout.tsx
apps/web/src/app/globals.css
apps/web/src/app/page.tsx
apps/web/src/app/error.tsx
apps/web/src/app/not-found.tsx
apps/web/src/app/wiki/page.tsx
apps/web/src/app/curriculum/page.tsx
apps/web/src/app/papers/[id]/page.tsx
apps/web/src/app/settings/page.tsx
apps/web/src/components/workspace.tsx
apps/web/src/components/ui.tsx
apps/web/src/components/library.tsx
apps/web/src/components/jobs.tsx
apps/web/src/components/pdf-viewer.tsx
apps/web/src/components/reader.tsx
apps/web/src/components/markdown.tsx
apps/web/src/components/wiki.tsx
apps/web/src/components/lesson-blocks.tsx
apps/web/src/components/curriculum.tsx
apps/web/src/components/learning-records.tsx
apps/web/src/components/settings.tsx
apps/web/src/lib/api.ts
apps/web/src/lib/types.ts
apps/web/src/lib/pdf-mapping.ts
apps/web/src/lib/lesson-blocks.ts
tests/ui-helpers.test.ts
tests/ui-workspace.spec.ts
tests/ui-report.md
```

No API/MCP paths, root package/lock/configuration, backend/provider/security implementation, or Git state were edited by this worker. The PDF implementation was checked against installed PDF.js 6 declarations and the [official PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/); the screenshot/behavior evidence above is from the actual local application.
