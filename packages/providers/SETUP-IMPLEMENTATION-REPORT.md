# Backend reader setup implementation report

Completed backend dispatch `task_2e69900e51d9` / `ctx_d621eb7cb6a7`, 2026-09-09 KST. Source is final for root integration rebuild. No Git commit, production build, container action, live provider request, live config write or live secret read/write was performed by this worker; all runtime tests used temporary directories, synthetic keys, mocked HTTP and in-memory PGlite databases.

## Implemented

- Defaulted schema adds provider `reasoningEffort`, per-function `ai.taskModels`, onboarding completion/deferral, developer mode, and a server-managed `verificationRevision` epoch. Old config files retain existing values and credentials. The epoch advances on relevant provider/model/AI-policy saves, preserving reader/onboarding-only changes and preventing A-to-B-to-A evidence resurrection.
- Functional selection uses `ai.defaults` plus an atomic nullable model override. Null inherits provider selection; an explicit override with omitted effort uses the model API default. Overrides do not cross into validation of another provider. PATCH replaces each supplied task selection atomically so omitted reasoning clears a previously saved effort.
- Exact OpenAI `gpt-5.6-sol` profile allows `none/low/medium/high/xhigh/max` via Responses; native request carries `reasoning: {effort: "high"}` when selected. No alias or alternative-model substitution is performed. Known embedding profiles remain separate from chat/summary/analysis support.
- New session-only, same-origin mutation routes: GET/POST `/api/v1/providers/:id/models` and GET/POST `/api/v1/providers/:id/validation`. GET never contacts a provider. Discovery uses the saved endpoint/key and native provider metadata. Claude Messages inventory supplies chat/streaming support; LM Studio inventory distinguishes llm/embedding; Ollama explicitly reads `/api/show` for the selected model plus the first 32 inventory entries, without loading or downloading models.
- Catalog combines availability with protocol profiles and supported functions. Unknown OpenAI model IDs remain visible but disabled with a reason until a supported profile exists. Missing requested Sol access is a failed/blocked gate, never a fallback selection.
- Metadata verification records config, policy, credential availability, listed model access and supported selection without inference. The separate inference action requires current passed metadata, its exact fingerprint, saved inference policy and `confirmPaid:true` for paid providers. It sends one short synthetic request with a fixed 512 output-token ceiling, `store:false`, standard OpenAI service tier and no paid retry. Incomplete streams stay incomplete and retain measured usage.
- Safe evidence is persisted in mode-0600 `provider-evidence-<id>.json` files within the config directory, using existing atomic private-write and locking protections. Evidence contains only allowlisted model metadata, report fields and numeric usage; no generated text, raw upstream usage, credentials or arbitrary provider details are persisted. Key revisions and relevant config epoch/settings enter fingerprints; stale reports return null individually.
- Generation snapshots and cache identity include resolved task selection/effort. Responses, usage `model_id`, artifact provenance and execution/publish stale guards use that selection. Measured input/output/reasoning usage is preserved even when a stream does not complete; failed output is not published as a cached artifact.

The full consumable API/config contract is [docs/BACKEND-SETUP-API.md](../../docs/BACKEND-SETUP-API.md). Provider catalog/report types are exported from `packages/security/src/provider-verification.ts`; pure report schemas/types are in `packages/security/src/verification-types.ts`.

## Validation

Final commands passed:

```text
npx tsc --noEmit --pretty false
npx vitest run tests/provider-setup.test.ts tests/domain-model-selection.test.ts tests/provider-contract.test.ts tests/provider-local-and-policy.test.ts tests/security.test.ts tests/domain-generation.test.ts tests/credential-import.test.ts
```

Result: **7 test files, 64 tests passed**. This includes 19 new backend tests covering backward defaults, credential preservation, exact Sol/high request bodies, unsupported combinations, cross-provider override isolation, effort clearing, local-only/no-consent/no-metadata/monetary-budget blocks, no outbound GET, session/CSRF restrictions, catalog selectability for Claude/Ollama, safe persisted usage, stale credentials/settings and A-to-B-to-A changes, task cache separation, queued-input rejection and incomplete generation usage. Owned source and tests were formatted with Prettier.

## Root integration and remaining limits

- Rebuild against this final source, including `verificationRevision`, atomic task-selection merge and the final models route validation/error mapping. Root's earlier build predates these changes.
- Root alone must activate the manually imported OpenAI credential in saved live config, choose exact `gpt-5.6-sol`/`high`, run metadata verification and then one explicitly approved paid synthetic inference. Use the returned current fingerprint; do not treat metadata success as inference success.
- The strict 512-token reasoning budget may produce `incomplete`, especially with high effort. This is reported honestly without retry. Any decision to change the ceiling or repeat live inference is root-owned.
- Paid synthetic checks are blocked when a monetary budget is configured because the repository has no verified price table/budget reservation for this path. This preserves existing conservative budget behavior; no price was invented and no false USD total is reported.
- This compact change does not implement existing deferred application features: durable branched chat, full analysis and broad RAG/index redesign remain outside this dispatch. Catalog functions express model/protocol compatibility; existing operation availability still applies.
- Official profiles intentionally cover exact Sol plus text-embedding-3-small/large. Other OpenAI discovery IDs require an added verified profile before the new setup gate can approve them. Existing unspecified-effort legacy adapter requests retain backward compatibility.
- Root retains UI/PDF browser acceptance, first launch/replay/reload, live model/account access, final production/Compose checks and integration fixes.

## Official sources checked

- [GPT-5.6 Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol): exact model ID, reasoning efforts, Responses support and output limit.
- [Create a model response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create): reasoning request object, `max_output_tokens`, `store` and `service_tier=default` standard pricing/performance.
- [text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small) and [text-embedding-3-large](https://developers.openai.com/api/docs/models/text-embedding-3-large): separate embedding profiles.
