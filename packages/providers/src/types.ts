export type AiAdapterId = "openai" | "anthropic" | "ollama" | "lmstudio";
export type TranslationAdapterId = "google-translate-v2";
export type AdapterId = AiAdapterId | TranslationAdapterId;

export type BillingClass = "paid" | "no_api_charge" | "free_tier" | "unknown";
export type ExecutionLocation = "local" | "remote" | "unknown";
export type CapabilitySupport = "supported" | "unsupported" | "unknown";
export type ReasoningEffort =
  "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type AiFunction = "summary" | "chat" | "analysis" | "embedding";

export interface ProviderCapabilities {
  chat: boolean;
  embedding: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  translation: boolean;
  modelListing: boolean;
  modelInspection: boolean;
}

export interface ModelCapabilities {
  chat: CapabilitySupport;
  embedding: CapabilitySupport;
  streaming: CapabilitySupport;
  structuredOutput: CapabilitySupport;
  vision: CapabilitySupport;
  toolUse: CapabilitySupport;
}

export interface ConfigFieldDefinition {
  key: string;
  label: string;
  kind: "text" | "url" | "boolean" | "credential-reference";
  required: boolean;
  secret: false;
  readOnly?: boolean;
  defaultValue?: string | boolean;
  description?: string;
}

export interface ProviderDefinition {
  adapterId: AdapterId;
  adapterVersion: string;
  displayName: string;
  billingClass: BillingClass;
  executionLocation: Exclude<ExecutionLocation, "unknown">;
  defaultEndpoint: string;
  fixedEndpoint: boolean;
  credentialRequired: boolean;
  capabilities: ProviderCapabilities;
  configFields: readonly ConfigFieldDefinition[];
  limitations: readonly string[];
}

export interface ProviderConfig {
  adapterId: AiAdapterId;
  providerInstanceId: string;
  enabled: boolean;
  endpoint: string;
  modelId?: string;
  modelRevision?: string;
  embeddingModelId?: string;
  reasoningEffort?: ReasoningEffort;
  credentialRef?: string;
}

export interface GoogleTranslationConfig {
  adapterId: TranslationAdapterId;
  providerInstanceId: string;
  enabled: boolean;
  endpoint?: string;
  credentialRef: string;
  translatorConfigVersion: string;
}

export interface RequestIdentity {
  logicalCallId: string;
  attempt: number;
  /** Reused for retransmission of the same attempt, changed for a new attempt. */
  idempotencyKey: string;
}

export interface ProviderCallContext {
  /** Supplied only after the caller has re-checked policy and credential revision. */
  credential?: string;
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  modelId: string;
  messages: readonly ChatMessage[];
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  serviceTier?: "default";
  requestIdentity: RequestIdentity;
}

export interface NormalizedUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Vendor response retained for auditing; it must never include credentials. */
  raw: Readonly<Record<string, unknown>>;
}

export type ProviderStreamEvent =
  | {
      type: "text";
      delta: string;
      requestIdentity: RequestIdentity;
      providerRequestId?: string;
    }
  | {
      type: "usage";
      usage: NormalizedUsage;
      requestIdentity: RequestIdentity;
      providerRequestId?: string;
    }
  | {
      type: "final";
      text: string;
      usage?: NormalizedUsage;
      complete: true;
      requestIdentity: RequestIdentity;
      providerRequestId?: string;
    }
  | {
      type: "abort";
      complete: false;
      requestIdentity: RequestIdentity;
      providerRequestId?: string;
    }
  | {
      type: "error";
      error: import("./errors").ProviderError;
      complete: false;
      requestIdentity: RequestIdentity;
      providerRequestId?: string;
    };

export interface EmbeddingRequest {
  modelId: string;
  input: string | readonly string[];
  requestIdentity: RequestIdentity;
}

export interface EmbeddingResult {
  vectors: number[][];
  usage?: NormalizedUsage;
  requestIdentity: RequestIdentity;
  providerRequestId?: string;
  complete: true;
}

export interface ModelInfo {
  id: string;
  displayName?: string;
  revision?: string;
  executionLocation: ExecutionLocation;
  localOnlyEligible: boolean;
  capabilities: ModelCapabilities;
  capabilitySource: "native" | "provider" | "unknown";
  details?: Readonly<Record<string, unknown>>;
}

export interface ConnectionTestResult {
  ok: true;
  providerRequestId?: string;
  modelCount: number;
  verification: "network" | "configuration_only";
}

export interface ProviderAdapter {
  readonly definition: ProviderDefinition;
  readonly config: Readonly<ProviderConfig>;
  listModels(context: ProviderCallContext): Promise<ModelInfo[]>;
  inspectModel(
    modelId: string,
    context: ProviderCallContext,
  ): Promise<ModelInfo>;
  chat(
    request: ChatRequest,
    context: ProviderCallContext,
  ): AsyncIterable<ProviderStreamEvent>;
  embed?: (
    request: EmbeddingRequest,
    context: ProviderCallContext,
  ) => Promise<EmbeddingResult>;
  testConnection(context: ProviderCallContext): Promise<ConnectionTestResult>;
}

export interface TranslationRequest {
  texts: readonly string[];
  sourceLanguage?: string;
  targetLanguage: string;
  requestIdentity: RequestIdentity;
}

export interface TranslationItem {
  sourceText: string;
  translatedText: string;
  detectedSourceLanguage?: string;
}

export interface TranslationAttribution {
  service: "Google Translate";
  displayText: "Powered by Google Translate";
  href: "https://translate.google.com";
  required: true;
}

export interface TranslationResult {
  items: TranslationItem[];
  characterCount: number;
  attribution: TranslationAttribution;
  requestIdentity: RequestIdentity;
  providerRequestId?: string;
  complete: true;
}

export interface TranslationAdapter {
  readonly definition: ProviderDefinition;
  readonly config: Readonly<GoogleTranslationConfig>;
  translate(
    request: TranslationRequest,
    context: ProviderCallContext,
  ): Promise<TranslationResult>;
  testConnection(context: ProviderCallContext): Promise<ConnectionTestResult>;
}

export type ProviderOperation =
  | "chat"
  | "embedding"
  | "translation"
  | "listModels"
  | "inspectModel"
  | "testConnection";

export interface ProviderCallPolicy {
  localOnly: boolean;
  allowExternalAi: boolean;
  allowExternalTranslation: boolean;
  paidAiEnabled: boolean;
  paperAllowsExternal: boolean;
  /** Host setting/log verification that cloud forwarding, LM Link, and similar routes are disabled. */
  localProviderIsolationVerified?: boolean;
}

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
