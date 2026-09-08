# Reader, model selection and first setup verification contract

Goal date: 2026-09-09. This contract records required outcomes, not completed work.

## Required outcomes

1. Reproduce the reported PDF failure through Computer Use in a visible browser; fix the cause and verify the rendered PDF, paging, zoom, selection and reopen behavior. Original mounted PDFs remain unchanged.
2. Configure the existing OpenAI API provider (the user calls it Codex) with exact model `gpt-5.6-sol` and reasoning effort `high`. This is API-key billing, not a claim that a ChatGPT/Codex subscription pays for API calls. Do not silently substitute another model if access is missing.
3. Provide a verification gate separating configuration/policy/credential, model availability and supported parameters, and an explicitly requested bounded inference check. Never label metadata-only verification as successful inference. Invalidate evidence when the relevant credential, endpoint, model or reasoning configuration changes.
4. Provide real model select controls fed by provider model discovery plus known protocol profiles. A discovered model is not automatically compatible with every function. Unsupported combinations must be explained and rejected, not silently rewritten.
5. Provide a first-setup dialog after authentication on an unconfigured installation, grouped by privacy/billing, providers, functional defaults and reading preferences. Persist completion, preserve existing settings and credentials, allow local-only completion and a safe later path.
6. Provide an explicitly enabled developer mode with a visible action to reopen the same dialog for testing. Replaying must not erase settings or credentials.
7. Verify with unit/integration contracts, rendered browser scenarios including first launch/replay/persistence and PDF regression, production build/Compose, and final Computer Use evidence. Keep main untouched until a real release is authorized.

## Parallel ownership

- Root: PDF viewer/reader, PDF tests and private fixture inspection, visual Computer Use, integration/build/runtime configuration, final acceptance audit and Git.
- Backend worker: provider schemas/adapters/model profiles/discovery and validation APIs; security config schema and validation persistence; domain generation reasoning/task model propagation; its own backend tests. Do not change live configuration or credentials or make real provider calls.
- UI worker: settings, workspace and new onboarding/model-selection components and their tests/styles. Do not change PDF files, provider/security/backend code, live configuration or credentials. Coordinate exact API/config types with backend.

## Shared interface direction

Keep existing config/defaults backward compatible. Add optional/defaulted provider `reasoningEffort`; add persisted onboarding and developer-mode state. Existing `ai.defaults` selects providers per function; add per-function model overrides only where needed so the wizard can configure each function without accidentally replacing another function's model. Generation must honor the selected profile and effort in request bodies and cache identity.

Use session-only provider model discovery and validation routes under `/api/v1/providers/:id/`. GET reads cached/catalog state only; explicit POST refresh may contact the saved provider subject to policy. Metadata and paid inference validation are separate actions. An inference gate uses a short synthetic prompt, no paper content, standard service tier, a strict output-token ceiling and no automatic paid retry. Persist only safe report metadata, usage, status and relevant fingerprints, never key values.

Backend sends the UI worker exact types and endpoint contracts early. UI exposes separate paid/local providers and Google translation. Never download a model, install a local AI service, or enable paid/remote processing merely by opening a dialog.

## Source

- [GPT-5.6 Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol): explicit model ID, `high` support, Responses protocol and model limits. Exact model availability is still subject to live account verification.

## Completion evidence

See [READER-SETUP-ACCEPTANCE.md](READER-SETUP-ACCEPTANCE.md) for the completed verification record: real Safari reproduction and repair, exact runtime model/high, first-run/replay/persistence, 171 source tests, 16 Chromium plus 2 WebKit browser tests, actual PostgreSQL regression and production builds. OpenAI metadata verification passed; both bounded live inference checks ended incomplete and are explicitly recorded as not successful. Further paid provider diagnosis remains separate from the implemented gate and UI.
