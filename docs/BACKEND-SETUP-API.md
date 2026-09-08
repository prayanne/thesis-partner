# Backend setup interface

Implementation contract for the UI and root worker, 2026-09-09.

## Config

- `providers[].reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max"` (omitted preserves prior behavior).
- `ai.taskModels: {summary: TaskModel | null, chat: TaskModel | null, analysis: TaskModel | null, embedding: TaskModel | null}` defaults to all null. `TaskModel = {modelId: string, reasoningEffort?: ReasoningEffort}`. Provider choice remains `ai.defaults[function]`; null override inherits the provider model/effort. A non-null override with omitted effort uses the model API default, without inheriting provider effort. Overrides apply only to the function's selected provider, so validating another provider uses that provider's own model. Embedding uses `embeddingModelId` and cannot have reasoning effort.
- `onboarding: {completedAt: string | null, deferredAt: string | null}` defaults to both null. Completion and deferral use ISO datetimes, independently of paid/local selection. Reopening the dialog does not change completion; completion clears deferredAt.
- `developer: {enabled:boolean}` defaults to false. Existing credentials and settings survive defaulted schema migration.
- Existing GET/PATCH `/api/v1/config` envelopes and optimistic `expectedRevision` remain unchanged.
- `verificationRevision:number` is a server-managed epoch, default 1 for older files. Relevant provider/AI-policy/model edits advance it; reader/onboarding/developer-only edits preserve it. It prevents changing a setting away and back from resurrecting old verification evidence; no UI control is needed.

## Session-only provider endpoints

Every endpoint requires a browser session (bearer tokens rejected), applies no-store, and returns `{data: ...}`. No GET initiates provider traffic. All actions use saved config, never browser-supplied endpoints, keys or paper text.

`GET /api/v1/providers/:id/models` returns `ProviderModelCatalog`:

```ts
type AiFunction = "summary" | "chat" | "analysis" | "embedding";
type ModelChoice = {
  id: string;
  displayName: string;
  available: boolean | null; // null = no current discovery evidence
  supportedFunctions: AiFunction[];
  reasoningEfforts: ReasoningEffort[];
  protocol: "responses" | "messages" | "chat-completions" | "embeddings" | "unknown";
  profileSource: "official" | "native" | "unknown";
  selectable: boolean;
  reason?: string;
};
type ProviderModelCatalog = {
  providerId: string;
  fingerprint: string;
  discoveredAt: string | null;
  stale: boolean;
  models: ModelChoice[];
};
```

`POST /api/v1/providers/:id/models` with `{}` explicitly refreshes remote/local metadata under saved policy and returns the same catalog. Known official profiles appear before discovery with `available:null`; they do not assert account access. Unknown discovery IDs are shown with reasons when unsupported. Native local inventory supplies capabilities; no model downloads occur.

`GET /api/v1/providers/:id/validation?function=summary` returns `ProviderValidationState`:

```ts
type ValidationReport = {
  id: string;
  stage: "metadata" | "inference";
  function: AiFunction;
  fingerprint: string;
  checkedAt: string;
  status: "passed" | "blocked" | "failed" | "incomplete";
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  inferencePerformed: boolean;
  code: string;
  message: string;
  maxOutputTokens?: number;
  serviceTier?: "default";
  providerRequestId?: string;
  usage?: {inputTokens?:number;outputTokens?:number;totalTokens?:number;reasoningTokens?:number;cacheReadTokens?:number};
};
type ProviderValidationState = {
  providerId: string;
  function: AiFunction;
  fingerprint: string;
  metadata: ValidationReport | null;
  inference: ValidationReport | null;
  stale: boolean;
};
```

`POST /api/v1/providers/:id/validation` accepts `{stage:"metadata"|"inference", function?:AiFunction, confirmPaid?:boolean, expectedFingerprint?:string}` (function defaults to summary). Returns the same validation state. Metadata verifies enabled/config, policy, credential, discovered availability and supported profile without inference. Inference requires a current passed metadata report plus its exact `expectedFingerprint`; paid providers additionally require `confirmPaid:true` and saved paid policy. Inference uses one short synthetic prompt, a fixed 512 output-token ceiling, `store:false`, standard service tier for OpenAI, and no automatic retries. It persists allowlisted numeric usage and report metadata only, never text or raw upstream bodies. An incomplete response is not a successful inference.

Fingerprints cover saved provider endpoint/model/reasoning, the selected task override, relevant policy and credential revision. Current reports are returned as null after a fingerprint change, with `stale:true` when older evidence exists. Discovery and validation writes do not bump config revision. Legacy POST `/api/v1/providers/:id/tests` remains explicitly metadata-only.

## Official source

Exact `gpt-5.6-sol` profile and reasoning options verified from https://developers.openai.com/api/docs/models/gpt-5.6-sol. No model substitution. Live activation, key access, billable calls, build/runtime and integration acceptance remain root-owned.
