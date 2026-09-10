# Translation page read-model review

Reviewed on 2026-09-10 with synthetic fixtures only. The final focused run passed **68 tests** against the coordinator's current implementation of `apps/web/src/lib/translation-page.ts`.

Worker-owned changes are limited to `tests/translation-page.test.ts` and this report. Production implementation changes were made by the coordinator. No live configuration, credentials, paper files, database, external service, network request, Docker operation, build, or Git command was used for this review.

## Verification

```sh
node_modules/.bin/vitest run tests/translation-page.test.ts
```

Final run at 14:43:39 Asia/Seoul: **1 test file passed, 68 tests passed**, Vitest 5.0.0, Node 24.20.0. Fixtures compute expected hashes independently with Node's `createHash`, while the implementation uses Web Crypto.

The suite covers:

- Exact source text, segment digest, artifact source digest, extraction run, and paper revision binding; absent provenance or segment revision disables linking while saved text remains readable.
- Exact alignment source and target text, target digest, equal-length target replacement, Unicode normalization differences, and both bare and `sha256:`-prefixed hashes.
- The final `wordAlignment` schema, recognized method/status, partial mappings without guessed links, and phrase fallback for legacy `segments`/`items` plus `translatedText` payloads. Metadata stored only under the retired `alignment` property cannot enable word links.
- Complete UTF-16 surrogate pairs; rejection of split pairs, fractional or out-of-bounds offsets, reversed or empty intervals, and nonfinite endpoints.
- Duplicate or absent marker identities, duplicate ranges, source-only overlaps, target-only overlaps, and valid adjacent ranges.
- Reordered target words, source and translation focus, missing-word fallback, multi-link focus ambiguity, and focus on another or unlinked segment.
- Current segment order, missing translations, whitespace-only source items, unrelated artifact rows, and malformed payloads.
- Source sentences spanning multiple same-line TextItems and a line wrap; source rather than target punctuation; paragraph gaps; indentation changes; heading/body boundaries and heading line spacing; explicit paragraph boundaries; multi-sentence item fallback; missing and unverified rows as barriers.

## Findings and disposition

1. **Generation identity was not originally checked.** Matching text and hashes alone let an artifact from another extraction/revision claim a current source mapping. The coordinator added provenance checks; mismatched and missing identity regressions now pass.

2. **Marker IDs were originally ignored.** Two disjoint source/target intervals could share one marker ID and remain linked. The coordinator added identity validation; duplicate, missing, empty, and non-string marker IDs now reject the row's word links.

3. **Sentence fallback originally crossed ambiguous or unverified items.** A TextItem containing an internal sentence boundary could absorb neighbors, and asking for an unlinked item could return linked neighbors. The coordinator added multi-sentence and focused-row checks; the corresponding regressions now pass.

4. **A normal line wrap was incorrectly treated as a paragraph break.** The first focused run reproduced a failure with 58/59 passing tests: source items at `(40,700)` and `(120,700)`, followed by `(40,686)` at height 10, split one sentence because the next line start was compared with the previous line's trailing item. The coordinator changed the comparison to use the previous line start/minimum x; both this case and a genuine indentation change now pass.

No failing test remains in the final run. The tests retain the failure expectations as ordinary regressions, without skipped tests or expected-failure markers.

## Semantic and mapping limits

The verified contract is exact identity and conservative range handling. Retained Google HTML markers are provider-derived associations, and these tests cannot establish that a translated word is linguistically equivalent to the source word. Hashes bind metadata to the precise strings; they do not establish translation correctness.

Paragraph layout and sentence grouping remain presentation heuristics. The implementation can highlight a source phrase when a complete sentence cannot be isolated, and individual TextItems containing multiple sentences intentionally remain indivisible. The synthetic fixtures do not establish accuracy for abbreviations split across TextItems, every writing direction, arbitrary PDF column order, rotated text, or unusual line spacing.

This task validates the pure read model only. Browser selection geometry, DOM rendering, keyboard navigation, React update behavior, and real PDF/provider behavior require separate validation by their owners. No additional read-model fix is required by the final focused results.
