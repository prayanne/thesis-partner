# Implementation coordination — 2026-09-08

This is an incremental implementation of Planning v0.2, not a claim all acceptance criteria have passed. Original plans remain authoritative. No real API key has been created: secure local destination was declined and OpenAI connector requires reauthentication. No paid/model calls or credential provisioning by workers; use HTTP mocks. New-key choice was already answered by the user; do not repeat credential questions.

## Shared checkout ownership

- Coordinator: root package/lock/TypeScript/Next config, Compose/Docker, `packages/security`, `scripts/setup-local.ts`, integration/health/config/session routes, deployment documentation. Only coordinator runs dependency installation and Git commands.
- UI worker: `apps/web/src/app` pages/layout/styles EXCEPT all `api` and `mcp` paths, `apps/web/src/components`, `apps/web/src/lib`, public UI assets, `tests/ui-*`. Own any client DTO helpers; no fake successful data fallback.
- Backend worker: `packages/db`, `packages/domain`, `packages/contracts`, `apps/worker`, REST catch-all `apps/web/src/app/api/v1/[...path]/route.ts`, `tests/db-*`, `tests/domain-*`. Read security API below; no edits to coordinator routes.
- Providers worker: `packages/providers`, `tests/provider-*`; no key/config filesystem writes. Export adapters/policy as a typed module, tell backend worker the contract promptly.

Use relative imports or exact aliases `@thesis/security`, `@thesis/providers`, `@thesis/db`, `@thesis/domain`, `@thesis/contracts` (package barrels). npm dependencies are installed at root; no extra package manifests. Ask coordinator for new dependency. No Git commits/switch/reset in workers. Keep edits within ownership, preserve concurrent changes. Use apply_patch. Report tests and unimplemented criteria honestly.

## UI/REST contract

REST prefix `/api/v1`, JSON success `{data: T, meta?: {...}}`, failure `{error: {code: string, message: string}}`. UUID identifiers, expectedRevision on PATCH, DELETE is archive. Fetches authenticated with HttpOnly cookie. GET must not start external calls. Loading/empty/error/config-required states are real states, not fake seeded results.

Initial core endpoints: GET/POST `/papers` (POST `{relativePath}`), GET/PATCH/DELETE `/papers/:id`, GET `/papers/:id/file` (binary PDF range), GET `/papers/:id/segments?pageNumber=1`, GET/POST `/papers/:id/annotations`, GET/PATCH `/papers/:id/reading-state`, POST `/library/scan`, GET `/library/files`, GET `/jobs/:id`, GET `/jobs/:id/events`, POST `/jobs/:id/cancel`, POST `/papers/:id/translations`, POST `/papers/:id/summaries`, POST `/papers/:id/chat`, GET `/papers/:id/artifacts?operation=translation`, GET `/papers/:id/analysis`, GET `/papers/:id/relations`.

Learning: GET/POST `/wiki`, GET/PATCH/DELETE `/wiki/:id`, POST `/wiki/:id/restore`, GET/POST `/curricula`, GET/PATCH/DELETE `/curricula/:id`, POST `/curricula/:id/restore`, GET/POST `/curricula/:id/items`, PATCH/DELETE `/curriculum-items/:id`, POST `/curriculum-items/:id/restore`, POST `/curricula/:id/reorder`, POST `/curricula/:id/dependencies`, POST `/study-sessions`, POST `/exercise-submissions`, PUT `/learning-progress`.

Generation body `{cacheMode:'use'|'refresh', requestId:UUID, ...scope}`. No UI rerender/F5/hover triggers generation. Return 202 job handle or 200 cached artifact. Polling is adequate initially. Save unavailable features as explicit `NOT_IMPLEMENTED` or `blocked_config`, never successful placeholder.

Coordinator routes: GET `/api/health` liveness, GET/POST/DELETE `/api/v1/session` (GET authentication status, POST `{token}`), GET/PATCH `/api/v1/config` (`{expectedRevision,patch}`), PUT/DELETE `/api/v1/credentials/:id` (`{value}` write-only), GET `/api/v1/provider-definitions`.

Security barrel planned exports:
```ts
type Principal = {kind:'session'|'token'; scopes:string[]};
class AppError extends Error { code:string; status:number; }
authorize(request:Request, scope?:string):Promise<Principal>;
readConfig():Promise<AppConfig>;
updateConfig(patch:unknown, expectedRevision:number):Promise<AppConfig>;
readCredential(id:string):Promise<string|undefined>;
```
`authorize` performs Host/Origin/auth/scope checks. Catch AppError for status, mask unknown internal errors. API routes must authorize before filesystem/DB actions. File serving only resolves mounted library relative paths with realpath containment and rejects symlink escapes.

AppConfig has schemaVersion:1, revision, general:{displayName,language,timeZone}, network:{localOnly,allowExternalAi,allowExternalTranslation,allowExternalMetadata}, ai:{paidAiEnabled,maxOutputTokens,monthlyBudgetUsd:number|null,defaults:{summary,chat,analysis,embedding} each string|null}, translation:{enabled,targetLanguage,monthlyCharacterLimit:number|null}, providers: array of {id,adapterId:'openai'|'anthropic'|'ollama'|'lmstudio',enabled,endpoint,modelId,modelRevision,embeddingModelId,credentialRef?:string}, library:{rootId:'papers'}, reading:{scale:number}. Defaults safe/off, local provider URLs host defaults 127.0.0.1 vs container host.docker.internal; Google key ref `google-translation`.

DB configuration: production PostgreSQL via DATABASE_URL. Optional PGlite only as test adapter, never silently replace production DB. Coordinator Docker daemon is currently unavailable; record that limit, but run local unit tests and embedded PG migration tests. Library root env PAPERS_DIR (host `./library`, Compose `/library`), APP_DATA_DIR (host `./data`, Compose `/data`), CONFIG_DIR (host APP_DATA_DIR/config, Compose `/config`), ARTIFACTS_DIR (host APP_DATA_DIR/artifacts, Compose `/artifacts`), MASTER_KEY_FILE (host explicit or APP_DATA_DIR/master.key, Compose `/run/secrets/master_key`).

Backend worker should implement reusable domain dispatch `executeOperation` or export services usable by later MCP transport, not duplicate domain rules in routes. Focus durable CRUD/extraction/jobs/cache and tested DB invariants, not pretending unvalidated word alignment or MCP is done. Send exact frontend-facing DTO/endpoints promptly to UI worker through coordinator.
