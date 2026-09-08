# Settings and first-setup UI handoff

Completed UI scope for `docs/READER-SETUP-CONTRACT.md`, 2026-09-09.

## Result

- Settings keeps the paid/local provider tabs and Google Translation controls, while sharing privacy/billing, reading, key, provider and function-default fields with the first-setup dialog.
- Provider model selectors use the session-only saved catalog GET route. Only explicit model refresh POST contacts a provider; no UI mount effect initiates provider POST, installation, download or inference.
- Model options explain official/native/unknown profile, availability, protocol, supported functions, unavailable IDs and unsupported reasoning. Existing unknown IDs and efforts remain visible; no automatic substitute is selected. The requested OpenAI identity is displayed exactly as `gpt-5.6-sol / high`, with API billing distinguished from ChatGPT/Codex subscription billing.
- Each provider exposes separate metadata and inference evidence for a selected function. Unsaved edits disable discovery/verification; inference additionally requires matching current passed metadata and explicit paid consent when applicable. The POST carries the current fingerprint and paid confirmation, and labels metadata-only and incomplete results separately from successful inference. Credential/config/function changes reset evidence and consent; late validation results from the previous context are ignored.
- A historical stale inference report does not suppress a newly passed metadata report with a matching current fingerprint; evidence is evaluated per report.
- Per-function model/effort overrides retain the provider defaults and other functions. Choosing no provider clears only that function's override.
- The native modal opens only after authentication when onboarding completion and defer timestamps are both absent. It groups privacy/billing, providers/keys, function defaults and reading settings.
- Normal completion persists the chosen configuration. Local-only completion blocks external policy and paid AI while retaining provider IDs, credentials references, model values and function defaults. Later discards the dialog draft and updates the latest saved config with `deferredAt`, retaining concurrent saved changes; completion survives replay and later dismissal.
- Settings exposes an explicit developer-mode toggle. After saving it, the visible “첫 설정 다시 열기” action opens the same wizard without resetting completion, configuration or credentials. Deferred setup exposes a continue action across page reloads.
- Dedicated CSS Module styles avoid changes to global reader CSS. Existing settings test labels from `tests/ui-workspace.spec.ts` remain present; that live mutation suite was not run by this worker.

## Changed files owned by this worker

- `apps/web/src/components/settings.tsx`
- `apps/web/src/components/workspace.tsx`
- `apps/web/src/components/first-setup.tsx`
- `apps/web/src/components/model-select.tsx`
- `apps/web/src/components/provider-settings.tsx`
- `apps/web/src/components/setup-fields.tsx`
- `apps/web/src/components/setup.module.css`
- `apps/web/src/lib/setup-models.ts`
- `tests/ui-setup-helpers.test.ts`
- `tests/ui-setup.spec.ts`
- This handoff document.

## Verification

All commands completed successfully against the final UI source:

```sh
npm run typecheck
npx vitest run tests/ui-setup-helpers.test.ts
UI_TEST_URL=http://127.0.0.1:3001 npx playwright test tests/ui-setup.spec.ts --output test-results/setup --workers=1 --reporter=line
npx prettier --check apps/web/src/components/settings.tsx apps/web/src/components/workspace.tsx apps/web/src/components/setup-fields.tsx apps/web/src/components/first-setup.tsx apps/web/src/components/model-select.tsx apps/web/src/components/provider-settings.tsx apps/web/src/components/setup.module.css apps/web/src/lib/setup-models.ts tests/ui-setup-helpers.test.ts tests/ui-setup.spec.ts
```

- TypeScript: passed.
- Dedicated unit tests: 8 passed, approximately 0.26 seconds.
- Dedicated Chromium browser scenarios: 6 passed in 5.0 seconds.
- Owned source/test formatting: passed.

Browser coverage includes authenticated first launch, no automatic provider POST, defer/reload, local-only completion, another page/session view of persisted state, explicit developer activation and replay, normal completion, exact model/high selection, unsupported function/model disabling, separate metadata/paid-consent gate, credential invalidation, independent function overrides, and draft preservation plus safe defer after a revision conflict.

The browser suite intercepts every `/api/v1/**` request with synthetic data, including login and credential writes. It reads no bootstrap token, live config or actual key and performs no real provider request. The root-owned dev server on port 3001 was used only to serve frontend code; this worker did not start or stop it.

## Integration notes for root

- Final root rebuild must include the latest UI source after the initial production checkpoint, particularly the reasoning label, per-report stale evidence handling, late-result guard, function deselection and safe defer conflict handling.
- Backend now replaces each non-null `ai.taskModels[function]` atomically during config PATCH; this worker verified the implementation in `packages/security/src/index.ts` after reporting that recursive merge would otherwise retain an earlier explicit effort. Backend regression ownership remains with its worker/root.
- Root retains ownership of actual provider account/model access, paid inference, live onboarding persistence acceptance, Safari/Computer Use, PDF regression, production build/deployment and release decisions.
- This worker did not edit PDF reader/viewer/mapping, backend/provider/security source, global reader CSS, production config or credentials; did not create Git commits; and did not run production builds or container lifecycle actions.
