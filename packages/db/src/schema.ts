import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  boolean,
  doublePrecision,
  numeric,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const archived = () => timestamp("archived_at", { withTimezone: true });
const revision = () => integer("revision").notNull().default(1);
// SQL migrations are authoritative for deferred composite FKs, CHECKs and triggers.
export const papers = pgTable("papers", {
  id: id(),
  title: text("title").notNull(),
  doi: text("doi"),
  abstract: text("abstract"),
  language: text("language"),
  readingStatus: text("reading_status").notNull().default("unread"),
  userPriority: integer("user_priority"),
  tags: text("tags").array().notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  currentRevisionId: uuid("current_revision_id"),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
  updatedAt: updated(),
});
export const paperRevisions = pgTable("paper_revisions", {
  id: id(),
  paperId: uuid("paper_id")
    .notNull()
    .references(() => papers.id),
  contentHash: text("content_hash").notNull().unique(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  pageCount: integer("page_count"),
  activeExtractionId: uuid("active_extraction_id"),
  state: text("state").notNull().default("pending"),
  createdAt: created(),
});
export const paperSources = pgTable(
  "paper_sources",
  {
    id: id(),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id),
    rootId: text("root_id").notNull(),
    relativePath: text("relative_path").notNull(),
    observedHash: text("observed_hash").notNull(),
    missingAt: timestamp("missing_at", { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("paper_sources_path").on(t.rootId, t.relativePath)],
);
export const extractionRuns = pgTable("extraction_runs", {
  id: id(),
  paperRevisionId: uuid("paper_revision_id")
    .notNull()
    .references(() => paperRevisions.id),
  extractorVersion: text("extractor_version").notNull(),
  segmenterVersion: text("segmenter_version").notNull(),
  state: text("state").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: created(),
});
export const paperSegments = pgTable(
  "paper_segments",
  {
    id: id(),
    extractionRunId: uuid("extraction_run_id")
      .notNull()
      .references(() => extractionRuns.id),
    pageStart: integer("page_start").notNull(),
    orderKey: integer("order_key").notNull(),
    sourceText: text("source_text").notNull(),
    textHash: text("text_hash").notNull(),
    anchors: jsonb("anchors").notNull(),
    quality: jsonb("quality").notNull(),
  },
  (t) => [uniqueIndex("segment_order").on(t.extractionRunId, t.orderKey)],
);
export const paperChunks = pgTable("paper_chunks", {
  id: id(),
  extractionRunId: uuid("extraction_run_id")
    .notNull()
    .references(() => extractionRuns.id),
  chunkerVersion: text("chunker_version").notNull(),
  orderKey: integer("order_key").notNull(),
  segmentRanges: jsonb("segment_ranges").notNull(),
  text: text("text").notNull(),
  textHash: text("text_hash").notNull(),
  tokenCount: integer("token_count"),
});
export const annotations = pgTable("annotations", {
  id: id(),
  paperId: uuid("paper_id")
    .notNull()
    .references(() => papers.id),
  paperRevisionId: uuid("paper_revision_id")
    .notNull()
    .references(() => paperRevisions.id),
  anchor: jsonb("anchor").notNull(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  color: text("color").notNull(),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
  updatedAt: updated(),
});
export const jobs = pgTable("jobs", {
  id: id(),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").unique(),
  state: text("state").notNull().default("queued"),
  input: jsonb("input").notNull(),
  generation: integer("generation"),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  errorCode: text("error_code"),
  progress: jsonb("progress").notNull(),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
});
export const jobEvents = pgTable(
  "job_events",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.sequence] })],
);
export const cacheEntries = pgTable("cache_entries", {
  logicalKey: text("logical_key").primaryKey(),
  operation: text("operation").notNull(),
  latestRequestedGeneration: integer("latest_requested_generation").notNull(),
  currentArtifactId: uuid("current_artifact_id"),
  accessedAt: timestamp("accessed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const generatedArtifacts = pgTable(
  "generated_artifacts",
  {
    id: id(),
    logicalKey: text("logical_key")
      .notNull()
      .references(() => cacheEntries.logicalKey),
    generation: integer("generation").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    payload: jsonb("payload").notNull(),
    provenance: jsonb("provenance").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("artifact_generation").on(t.logicalKey, t.generation)],
);
export const wikiPages = pgTable("wiki_pages", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  currentRevisionId: uuid("current_revision_id"),
  state: text("state").notNull(),
  seedKey: text("seed_key").unique(),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
  updatedAt: updated(),
});
export const wikiRevisions = pgTable(
  "wiki_revisions",
  {
    id: id(),
    wikiId: uuid("wiki_id")
      .notNull()
      .references(() => wikiPages.id),
    revision: revision(),
    markdown: text("markdown").notNull(),
    sourceRefs: jsonb("source_refs").notNull(),
    origin: text("origin").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("wiki_revision_number").on(t.wikiId, t.revision)],
);
export const researchProjects = pgTable("research_projects", {
  id: id(),
  title: text("title").notNull(),
  domain: text("domain").notNull(),
  description: text("description").notNull(),
  summaryMarkdown: text("summary_markdown").notNull(),
  status: text("status").notNull().default("active"),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
  updatedAt: updated(),
});
export const projectMaterials = pgTable("project_materials", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => researchProjects.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  paperId: uuid("paper_id").references(() => papers.id),
  wikiId: uuid("wiki_id").references(() => wikiPages.id),
  sourceUrl: text("source_url"),
  content: text("content").notNull(),
  note: text("note").notNull(),
  position: integer("position").notNull().default(0),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
  updatedAt: updated(),
});
export const curricula = pgTable("curricula", {
  id: id(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  seedKey: text("seed_key").unique(),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
  updatedAt: updated(),
});
export const curriculumItems = pgTable("curriculum_items", {
  id: id(),
  curriculumId: uuid("curriculum_id")
    .notNull()
    .references(() => curricula.id),
  parentId: uuid("parent_id"),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  position: integer("position").notNull(),
  contentVersion: integer("content_version").notNull(),
  estimatedMinutes: integer("estimated_minutes"),
  seedKey: text("seed_key").unique(),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
  updatedAt: updated(),
});
export const curriculumDependencies = pgTable("curriculum_dependencies", {
  id: id(),
  curriculumId: uuid("curriculum_id")
    .notNull()
    .references(() => curricula.id),
  prerequisiteItemId: uuid("prerequisite_item_id")
    .notNull()
    .references(() => curriculumItems.id),
  dependentItemId: uuid("dependent_item_id")
    .notNull()
    .references(() => curriculumItems.id),
});
export const lessonBlocks = pgTable("lesson_blocks", {
  id: id(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => curriculumItems.id),
  blockKey: text("block_key").notNull(),
  kind: text("kind").notNull(),
  position: integer("position").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  payload: jsonb("payload").notNull(),
});
export const lessonRevisions = pgTable("lesson_revisions", {
  id: id(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => curriculumItems.id),
  contentVersion: integer("content_version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: created(),
});
export const learningResources = pgTable("learning_resources", {
  id: id(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  paperId: uuid("paper_id").references(() => papers.id),
  wikiId: uuid("wiki_id").references(() => wikiPages.id),
  readingScope: jsonb("reading_scope").notNull(),
  metadata: jsonb("metadata").notNull(),
  seedKey: text("seed_key").unique(),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
  updatedAt: updated(),
});
export const itemResources = pgTable(
  "item_resources",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => curriculumItems.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => learningResources.id),
    role: text("role").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.resourceId] })],
);
export const studySessions = pgTable("study_sessions", {
  id: id(),
  itemId: uuid("item_id").notNull(),
  lessonRevisionId: uuid("lesson_revision_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  elapsedSeconds: integer("elapsed_seconds").notNull(),
  reflection: text("reflection").notNull(),
  revision: revision(),
  archivedAt: archived(),
});
export const exerciseSubmissions = pgTable("exercise_submissions", {
  id: id(),
  itemId: uuid("item_id").notNull(),
  lessonRevisionId: uuid("lesson_revision_id").notNull(),
  blockKey: text("block_key").notNull(),
  sessionId: uuid("session_id").references(() => studySessions.id),
  answers: jsonb("answers").notNull(),
  evidencePath: text("evidence_path"),
  commitRef: text("commit_ref"),
  resultNote: text("result_note").notNull(),
  revision: revision(),
  archivedAt: archived(),
  createdAt: created(),
});
export const learningProgress = pgTable(
  "learning_progress",
  {
    itemId: uuid("item_id").notNull(),
    lessonRevisionId: uuid("lesson_revision_id").notNull(),
    state: text("state").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    revision: revision(),
    checks: jsonb("checks").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.lessonRevisionId] })],
);
export const paperAnalyses = pgTable("paper_analyses", {
  id: id(),
  paperId: uuid("paper_id")
    .notNull()
    .references(() => papers.id),
  analysisRevision: integer("analysis_revision").notNull(),
  sourceRevisionId: uuid("source_revision_id").references(
    () => paperRevisions.id,
  ),
  snapshot: jsonb("snapshot").notNull(),
  state: text("state").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const paperRelations = pgTable("paper_relations", {
  id: id(),
  sourcePaperId: uuid("source_paper_id")
    .notNull()
    .references(() => papers.id),
  targetPaperId: uuid("target_paper_id")
    .notNull()
    .references(() => papers.id),
  type: text("type").notNull(),
  state: text("state").notNull(),
  evidence: jsonb("evidence").notNull(),
  score: doublePrecision("score"),
  origin: text("origin").notNull(),
  revision: revision(),
  archivedAt: archived(),
});
export const readingStates = pgTable("reading_states", {
  paperId: uuid("paper_id")
    .primaryKey()
    .references(() => papers.id),
  paperRevisionId: uuid("paper_revision_id").notNull(),
  pageNumber: integer("page_number").notNull(),
  scale: doublePrecision("scale").notNull(),
  revision: revision(),
  updatedAt: updated(),
});
export const requestIdempotency = pgTable("request_idempotency", {
  requestId: uuid("request_id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  response: jsonb("response").notNull(),
  createdAt: created(),
});
export const publicationScopes = pgTable("publication_scopes", {
  scopeKey: text("scope_key").primaryKey(),
  requestRevision: integer("request_revision").notNull(),
  fingerprint: text("fingerprint").notNull(),
  currentArtifactId: uuid("current_artifact_id").references(
    () => generatedArtifacts.id,
  ),
});
export const seedApplications = pgTable("seed_applications", {
  seedKey: text("seed_key").primaryKey(),
  version: integer("version").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const budgetBuckets = pgTable(
  "budget_buckets",
  {
    scope: text("scope").notNull(),
    period: text("period").notNull(),
    providerId: text("provider_id").notNull(),
    reservedUsd: numeric("reserved_usd", { precision: 20, scale: 8 }).notNull(),
    settledUsd: numeric("settled_usd", { precision: 20, scale: 8 }).notNull(),
    reservedCharacters: bigint("reserved_characters", {
      mode: "number",
    }).notNull(),
    settledCharacters: bigint("settled_characters", {
      mode: "number",
    }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.period, t.providerId] })],
);
export const providerUsage = pgTable(
  "provider_usage",
  {
    id: id(),
    jobId: uuid("job_id").references(() => jobs.id),
    logicalCallId: text("logical_call_id").notNull(),
    attempt: integer("attempt").notNull(),
    budgetScope: text("budget_scope").notNull(),
    budgetPeriod: text("budget_period").notNull(),
    budgetTimezone: text("budget_timezone").notNull(),
    providerInstanceId: text("provider_instance_id").notNull(),
    modelId: text("model_id").notNull(),
    status: text("status").notNull(),
    reservedUsd: numeric("reserved_usd", { precision: 20, scale: 8 }),
    estimatedUsd: numeric("estimated_usd", { precision: 20, scale: 8 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    characters: bigint("characters", { mode: "number" }),
    reservedCharacters: bigint("reserved_characters", {
      mode: "number",
    }).notNull(),
    rawUsage: jsonb("raw_usage"),
    pricingRevision: text("pricing_revision"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("usage_attempt").on(t.logicalCallId, t.attempt)],
);
export const embeddingProfiles = pgTable("embedding_profiles", {
  id: id(),
  providerSnapshot: jsonb("provider_snapshot").notNull(),
  modelRevision: text("model_revision").notNull(),
  dimensions: integer("dimensions").notNull(),
  distance: text("distance").notNull(),
  preprocessingVersion: text("preprocessing_version").notNull(),
  createdAt: created(),
});
export const indexGenerations = pgTable("index_generations", {
  id: id(),
  embeddingProfileId: uuid("embedding_profile_id")
    .notNull()
    .references(() => embeddingProfiles.id),
  collectionName: text("collection_name").notNull().unique(),
  state: text("state").notNull(),
  corpusManifest: jsonb("corpus_manifest").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
});
