# Backend implementation handoff — 2026-09-08

Task `task_84afe35c96ca`, dispatch `ctx_3a0013a87feb`. This is the authorized durable local-core implementation wave, not completion of PLAN P0–P5.

## Implemented and integrated

- Production PostgreSQL adapter with no embedded-database fallback, executable Drizzle table definitions and `getDrizzleDatabase()`, and checksummed transactionally applied migrations `0001`–`0004`.
- Explicit PGlite test adapter in `packages/db/src/testing.ts`, excluded from the production barrel. Domain operations use parameterized SQL for locking and transactional invariants; Drizzle schema execution is also verified against native PostgreSQL.
- Durable papers, SHA-256 PDF revisions, multiple source paths, archive/restore and optimistic revisions. Same bytes at a renamed path reuse the paper/revision; changed bytes at the same path create a revision and preserve prior text/anchors. Mounted files are discovered read-only by GET and missing paths updated only by explicit scan.
- Realpath containment, final-component `O_NOFOLLOW`, regular-file/size checks, PDF signature and repeated hash/stat checks; immutable revision file serving verifies current bytes and supports ETag and single byte ranges. Original PDFs are not modified or copied as historical backups.
- PDF.js extraction into immutable extraction runs, exact TextItem text and UTF-16 source/item offsets, item hashes/transforms, page boxes and rotations. Conservative page-bounded chunks retain segment ranges. Text-free documents are marked `ocr_required`; unvalidated word rectangles are empty, not invented.
- Durable annotations, optional anchorless notes, validated revision/segment ranges, reading position and scale. Old revision annotations remain available when source bytes are missing.
- PostgreSQL jobs/outbox, leased `SKIP LOCKED` claim, heartbeat, attempts, explicit cancel/retry, polling events, extraction recovery, and atomic JSON exports. Expired external generation jobs become `OUTCOME_UNKNOWN`; the worker does not silently replay ambiguous paid calls.
- Request idempotency, generation numbers, immutable successful artifacts, same-key latest-generation fencing and cross-fingerprint publication scopes. Cancellation/failure preserves a prior successful artifact. Publication additionally checks the current PDF extraction and provider/credential configuration.
- Page/paper translation registration expands to canonical per-segment child generations in one transaction, plus a durable parent group job. Overlapping page and segment refreshes share the segment generation series. Current-page artifact reads aggregate current-extraction results in source order and retain per-segment artifact/generation identifiers.
- Native provider adapters are invoked through guarded fetches. Worker execution refreshes token authorization, passes credential expectedRevision, rechecks current policies and paper exclusions before network dispatch, and respects local provider isolation acknowledgement plus native model locality inspection. Paid/external scope denial is transactional and leaves no job/cache generation behind; existing cache reuse needs no new upstream call.
- Translation output is `payload.segments[]` with `sourceText`, `targetText`, `segmentId`, hashes, `alignmentStatus:'unavailable'`, and required Google attribution. Plain summaries include coverage and explicitly empty/unverified citations.
- Durable usage reservations and settlement, shared scope-before-provider budget lock order, idempotent logical call/attempt accounting, timezone-frozen budget periods, translation character limits and conservative unknown-outcome reservations. Configured monetary limits with missing verified pricing are blocked with `PRICE_REQUIRED`; unknown paid cost is not reported as zero.
- Durable Wiki revisions and curriculum/item CRUD, reorder and dependency add/remove, archive/restore, DB-level cycle/self/cross-curriculum/parent-kind checks, immutable lesson snapshots and revision-pinned linked Wiki/PDF resources in newly created snapshots.
- Study sessions, exercise submissions linked to the exact snapshot exercise block, and progress/completion checks. Completion requires reading confirmation, nonempty self-explanation answers, submissions for the snapshot exercises and explicit user confirmation. `checks.blockResponses` persists bounded per-block responses validated against the recorded snapshot.
- Explicit, idempotent seed: one CS curriculum, seven lessons, seven metadata-only paper records, twenty Korean conceptual Wiki pages, seven practical exercises, eleven dependency edges, and reading/resource links. No PDF download or automatic seed overwrite/revival occurs on startup.
- Separate Qdrant adapter for profile/generation-specific derived collections, upsert/query, dimension validation and honest unavailable status. It does not substitute a fake semantic result when Qdrant is absent.
- REST catch-all authorizes before filesystem/DB work, calls the same `executeOperation(input,{principal,db?})` services available to MCP, validates JSON/UUIDs and masks internal errors.

## Verification evidence

Local command:

```text
node_modules/.bin/vitest run tests/db-core.test.ts tests/domain-library.test.ts tests/domain-generation.test.ts tests/domain-index.test.ts
4 test files passed; 16 tests passed (2026-09-08 19:05 KST)
```

Coverage includes migration replay, Wiki optimistic conflicts/immutability, curriculum cycle rejection, old completed lesson preservation, cache replay/conflict/out-of-order publication, cancellation and expired-generation non-replay, cross-provider budget reservation, actual PDF.js extraction, rename/SHA dedupe, changed revisions, disk PGlite reopen, symlink/traversal rejection, UTF-16 surrogate/ligature identity offsets, stable atomic export, seed non-overwrite, mocked native Google calls/cache/refresh/page filtering, no-call local-only policy, transactional scope denial, overlapping translation generations, and Qdrant fallback/vector-space checks. A final targeted rerun also covers bounded blockResponses persistence and invalid snapshot keys.

Native PostgreSQL regression:

```text
TEST_DATABASE_URL=<provided privately in process environment> node_modules/.bin/vitest run tests/db-native.test.ts
1 test passed (2026-09-08 19:04 KST)
```

The native regression uses a temporary table and an intentionally rolled-back transaction. It verifies JSONB objects, arrays, null and nested values; Wiki create/update and sourceRefs shape; lesson blocks/snapshots; and a SQL insert built from the executable Drizzle schema. No application records are retained by this test. The URL/credential was not printed.

`node_modules/.bin/tsc --noEmit --pretty false` passed after integration. Coordinator separately reported actual PostgreSQL migrations through 0004, native HTTP/MCP smoke, and a real public 14-page PDF extraction with 2,436 segments and a partial JSON export; those integration results are coordinator evidence, not this worker's independent UI/Compose verification.

The first native smoke found postgres.js reserializing already encoded JSON strings, which the PGlite adapter did not reproduce. The production serializer now preserves explicitly serialized JSON for OIDs 114/3802. Migration 0003 repairs only encoded structured JSON columns; migration 0004 repairs the known nested bootstrap snapshot fields and labels missing historical revision pins. Existing IDs and records were preserved. Applied migration checksums must remain frozen.

## Remaining criteria and limitations

- Full AI paper analysis, durable branched chat/conversations, reference extraction/resolution, inferred relation CRUD/pipeline and importance scoring are not implemented. Chat and full analysis generation return explicit `NOT_IMPLEMENTED`; metadata/extraction analysis JSON stays honestly partial.
- Qdrant automatic embedding jobs, corpus manifests/activation verification, vector projections, semantic retrieval and reindexing are not wired into the worker. Library title/DOI matching remains usable; no semantic ranking is fabricated.
- PDF extraction currently follows PDF.js TextItem order. Sentence/column reconstruction, dehyphenation, cross-page sentence merging, word rectangles, word alignment, OCR and the planned multi-document alignment/geometry benchmark remain unverified/unimplemented.
- Translation page/paper groups currently make one upstream call per TextItem segment; batching multiple reserved segments into fewer provider calls is future optimization. No live Google/OpenAI/Anthropic/local-model inference calls were made in this worker run.
- Plain summaries are bounded to 100,000 input characters; hierarchical/map-reduce summaries, provider-context token budgeting and verified generated citations are not implemented. No partial stream token events are persisted; jobs expose progress/final status polling.
- There is no verified price table, so configured paid monetary budgets block calls with unknown model prices. Usage records support estimates/reservations, not provider account-wide billing reconciliation.
- Runtime dynamic config changes are rechecked before dispatch and monitored best-effort while requests run; transmitted data or upstream charges cannot be recalled.
- Library import hashing and PDF byte-range responses buffer the file (regular PDFs limited to 200 MiB). Large-library pagination, streaming file I/O and startup automatic scan are future work.
- Resource creation/linking and snapshot-preserving lesson edits are implemented; standalone resource PATCH and granular block endpoints are not. Session/submission creation and retrieval are implemented; their edit/archive endpoints, collections, cache eviction, backup/restore and public OpenAPI generation are not implemented by this worker.
- Legacy seed snapshots repaired from the original JSON transport defect cannot retroactively guarantee originally absent resource revision pins; migration 0004 labels that fact. New snapshots pin linked revisions.
- The current schema deliberately omits unimplemented conversations/messages/reference/collection feature tables rather than implying those features are available.

## Integration notes

- Restart the worker after final code changes; it does not watch source files.
- Production commands remain `npm run db:migrate`, `npm run db:seed`, and `npm run worker` with PostgreSQL configured by the coordinator's bootstrap. PGlite is test-only.
- Generation POST requires `library:read` and `ai:run`; a cache miss to paid remote services also requires `external:invoke` and `paid:invoke`. Generation inputs do not accept provider endpoints or credential values.
- Learning completion DTO is `checks:{readingConfirmed,selfExplanationAnswers,exerciseConfirmed,userConfirmed,blockResponses?}`; response keys use `blockKey:index` and are validated against the exact immutable lesson snapshot.
- Work stayed in backend-owned paths. No Git commands, installation, paid calls, key provisioning or unrelated infrastructure mutation were performed.
