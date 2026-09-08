# Reader and setup acceptance

Verified on 2026-09-09 KST in the local OrbStack deployment. This report distinguishes source tests, browser evidence and actual provider results.

## PDF failure and repair

Computer Use reproduced the failure in the installed Safari: page count was 14 but the reader displayed `undefined is not a function (near '...t of e...')` instead of the page. A development-only stack inspection localized it to PDF.js `getTextContent()` and `for await (const value of readableStream)`. The temporary stack display was removed after diagnosis.

Two compatibility safeguards are now in place:

- The browser uses the pinned PDF.js legacy build and matching versioned local worker, including its upstream JavaScript polyfills.
- Text content is consumed with `getReader().read()`, avoiding Safari's missing ReadableStream async iterator. Item order, styles and language are preserved; page changes cancel the pending reader and release its lock. The XFA-specific extraction path is retained. No global browser prototype is patched by the application.

The same failure is documented in [Mozilla PDF.js issue 20973](https://github.com/mozilla/pdf.js/issues/20973). Legacy build alone is insufficient for the affected Safari versions.

Actual Safari now displays the public 14-page TraceMonkey paper; Computer Use confirmed page 1, page 2 and 150% zoom. Chromium and WebKit regression tests deliberately remove the new Map helpers and ReadableStream async iteration, then verify painted canvas pixels, text selection, page/zoom/reopen and recovery after a failed PDF request. The live workspace test also verifies persisted source ranges, highlight geometry and saved reading position.

The mounted original `library/pdfjs-tracemonkey-validation.pdf` remains unchanged (SHA-256 `3662ff519e485810520552bf301d8c3b2b917fd2f83303f4965d7abed367e113`). Originals remain read-only in Compose.

## Configuration and first setup

- Existing OpenAI API credential reused without displaying or rotating it; this is API billing, not ChatGPT/Codex subscription authentication.
- Saved exact model `gpt-5.6-sol`, reasoning `high`, OpenAI enabled, paid AI enabled, external AI permitted. Google translation and external metadata remain disallowed; other AI providers remain disabled. Incoming access is still loopback only.
- Summary, chat and analysis defaults select OpenAI and inherit the exact model/effort; embedding remains unselected. Model protocol compatibility does not imply that the previously deferred chat/RAG/analysis application features are implemented.
- Real first authenticated launch displayed the grouped setup dialog. Computer Use completed local-only setup, then later reopened the same dialog through developer mode after OpenAI activation, inspected the actual model/high selects and functional defaults, and completed it again without clearing the credential or changing the AI policy.
- Completion is persisted in config, not just browser memory. Developer mode is enabled for the requested replay test; use **환경 설정 → 일반 · 읽기 → 첫 설정 다시 열기**.
- Model/key/policy changes invalidate old evidence, including change-and-revert cases. Reading and onboarding changes preserve evidence. GET catalog/status performs no provider request. Actual inference requires a current metadata gate and a separate explicit action/paid confirmation.

## Actual OpenAI evidence

Metadata verification made a real model-list request with the saved credential. The account returned 127 model entries including exact `gpt-5.6-sol`; the model/high metadata gate passed. [The official model profile](https://developers.openai.com/api/docs/models/gpt-5.6-sol) supports this model identifier and reasoning effort.

The first explicit synthetic inference used a 512 output-token ceiling, standard service tier, `store:false`, no paper content and no automatic retry. It returned an incomplete upstream stream, not a completed answer. No measured token usage was returned, so no token or dollar cost is invented. First provider request ID: `req_b546cbd6545947a89a4ca7c6d6da4761`.

After adding strict safe error-code classification, one final explicit diagnostic request used the same model/high, 512-token ceiling and standard tier. It also returned `UPSTREAM_STREAM_ERROR` with no recognized failure code and no measured usage; request ID `req_fc1b694a9e0b4c699413d4765ab9b0bf`, checked at `2026-09-08T17:42:11.757Z`. Exactly two synthetic inference requests were made during this task, with no automatic retries or paper-content upload. Authentication failure, exhausted quota, a token limit and a provider outage are not established by this result, so none is asserted as its cause. No failed response is described as successful inference. Further paid diagnosis is a separate explicit action, not an automatic continuation of this task.

## Verification commands

```sh
npm run typecheck
npm run test
npm run format:check
npm run build
npx playwright test tests/ui-workspace.spec.ts tests/ui-pdf-browser.spec.ts tests/ui-setup.spec.ts --workers=1 --reporter=line --output test-results/production
UI_PDF_BROWSER=webkit npx playwright test tests/ui-pdf-browser.spec.ts --workers=1 --reporter=line --output test-results/production-webkit
docker --context orbstack compose exec -T web node scripts/container-entrypoint.mjs test-native
```

Final source: 171 unit/integration tests passed, 1 opt-in native test skipped on host then separately passed against actual PostgreSQL. Final rebuilt production image: 16 Chromium tests passed (10.8 seconds) and 2 WebKit tests passed (3.2 seconds). UI-only setup tests intercept all API calls with synthetic data; PDF/workspace and Computer Use acceptance use the real local service. The native PostgreSQL test rolls back its test rows.

Host and container production builds passed. Build boundary inspection scanned 1,677 text assets with no private runtime files or bootstrap values included. Only web/worker were replaced; PostgreSQL and Qdrant were not reset. `.env`, master key and encrypted credential-store bytes remained unchanged and mode 0600; config/evidence are private mode 0600 and Git-ignored.

Development was performed on `feature/reader-model-onboarding` from `dev` (`539679e`). The source and acceptance record are committed and integrated into `dev` with a no-fast-forward merge at handoff; see the Git log for the resulting IDs. `main` remains at `a45a6d2`; no release or remote push is performed.
