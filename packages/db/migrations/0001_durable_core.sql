CREATE TABLE papers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, doi text, abstract text, language text,
 reading_status text NOT NULL DEFAULT 'unread' CHECK(reading_status IN ('unread','reading','completed')),
 user_priority integer CHECK(user_priority BETWEEN 1 AND 5), tags text[] NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}',
 current_revision_id uuid, revision integer NOT NULL DEFAULT 1, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE TABLE paper_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), paper_id uuid NOT NULL REFERENCES papers(id), content_hash text NOT NULL UNIQUE,
 byte_size bigint NOT NULL CHECK(byte_size >= 0), page_count integer, active_extraction_id uuid,
 state text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(paper_id,id)
);
-- statement
ALTER TABLE papers ADD CONSTRAINT current_revision_owner FOREIGN KEY(id,current_revision_id) REFERENCES paper_revisions(paper_id,id) DEFERRABLE INITIALLY DEFERRED;
-- statement
CREATE TABLE paper_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), paper_id uuid NOT NULL REFERENCES papers(id), root_id text NOT NULL CHECK(root_id='papers'),
 relative_path text NOT NULL, observed_hash text NOT NULL, missing_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(root_id,relative_path)
);
-- statement
CREATE TABLE extraction_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), paper_revision_id uuid NOT NULL REFERENCES paper_revisions(id), extractor_version text NOT NULL,
 segmenter_version text NOT NULL, state text NOT NULL DEFAULT 'running', metadata jsonb NOT NULL DEFAULT '{}', completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(paper_revision_id,id)
);
-- statement
ALTER TABLE paper_revisions ADD CONSTRAINT active_extraction_owner FOREIGN KEY(id,active_extraction_id) REFERENCES extraction_runs(paper_revision_id,id) DEFERRABLE INITIALLY DEFERRED;
-- statement
CREATE TABLE paper_segments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), extraction_run_id uuid NOT NULL REFERENCES extraction_runs(id), page_start integer NOT NULL CHECK(page_start > 0),
 order_key integer NOT NULL, source_text text NOT NULL, text_hash text NOT NULL, anchors jsonb NOT NULL, quality jsonb NOT NULL DEFAULT '{}', UNIQUE(extraction_run_id,order_key)
);
-- statement
CREATE TABLE paper_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), extraction_run_id uuid NOT NULL REFERENCES extraction_runs(id), chunker_version text NOT NULL, order_key integer NOT NULL,
 segment_ranges jsonb NOT NULL, text text NOT NULL, text_hash text NOT NULL, token_count integer, UNIQUE(extraction_run_id,chunker_version,order_key)
);
-- statement
CREATE INDEX paper_chunks_search ON paper_chunks USING gin(to_tsvector('english',text));
-- statement
CREATE TABLE annotations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), paper_id uuid NOT NULL REFERENCES papers(id), paper_revision_id uuid NOT NULL,
 anchor jsonb NOT NULL, kind text NOT NULL CHECK(kind IN ('note','highlight','bookmark')), text text NOT NULL DEFAULT '', color text NOT NULL DEFAULT '#fde68a',
 revision integer NOT NULL DEFAULT 1, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(paper_id,paper_revision_id) REFERENCES paper_revisions(paper_id,id)
);
-- statement
CREATE TABLE reading_states (
 paper_id uuid PRIMARY KEY REFERENCES papers(id), paper_revision_id uuid NOT NULL, page_number integer NOT NULL DEFAULT 1 CHECK(page_number>0), scale double precision NOT NULL DEFAULT 1 CHECK(scale BETWEEN 0.25 AND 5),
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(paper_id,paper_revision_id) REFERENCES paper_revisions(paper_id,id)
);
-- statement
CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, dedupe_key text UNIQUE, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','cancelled','blocked_config')),
 input jsonb NOT NULL DEFAULT '{}', generation integer, lease_owner text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 error_code text, progress jsonb NOT NULL DEFAULT '{}', cancel_requested boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE INDEX jobs_claim ON jobs(state,lease_until,created_at);
-- statement
CREATE TABLE job_events (job_id uuid NOT NULL REFERENCES jobs(id), sequence integer NOT NULL, type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,sequence));
-- statement
CREATE TABLE cache_entries (logical_key text PRIMARY KEY, operation text NOT NULL, latest_requested_generation integer NOT NULL DEFAULT 0, current_artifact_id uuid, accessed_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE TABLE generated_artifacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), logical_key text NOT NULL REFERENCES cache_entries(logical_key), generation integer NOT NULL, input_fingerprint text NOT NULL, payload jsonb NOT NULL, provenance jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(logical_key,generation));
-- statement
ALTER TABLE cache_entries ADD CONSTRAINT cache_artifact_fk FOREIGN KEY(current_artifact_id) REFERENCES generated_artifacts(id);
-- statement
CREATE TABLE request_idempotency (request_id uuid PRIMARY KEY, fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE TABLE publication_scopes (scope_key text PRIMARY KEY, request_revision integer NOT NULL DEFAULT 0, fingerprint text NOT NULL, current_artifact_id uuid REFERENCES generated_artifacts(id));
-- statement
CREATE TABLE paper_analyses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), paper_id uuid NOT NULL REFERENCES papers(id), analysis_revision integer NOT NULL, source_revision_id uuid REFERENCES paper_revisions(id), snapshot jsonb NOT NULL, state text NOT NULL, generated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(paper_id,analysis_revision));
-- statement
CREATE TABLE paper_relations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_paper_id uuid NOT NULL REFERENCES papers(id), target_paper_id uuid NOT NULL REFERENCES papers(id), type text NOT NULL CHECK(type IN ('similar_to','cites','extends','contrasts','prerequisite_of')), state text NOT NULL CHECK(state IN ('suggested','accepted','rejected')), evidence jsonb NOT NULL DEFAULT '[]', score double precision, origin text NOT NULL, revision integer NOT NULL DEFAULT 1, archived_at timestamptz, CHECK(source_paper_id<>target_paper_id), UNIQUE(source_paper_id,target_paper_id,type));
-- statement
CREATE TABLE wiki_pages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, title text NOT NULL, current_revision_id uuid, state text NOT NULL DEFAULT 'published', seed_key text UNIQUE, revision integer NOT NULL DEFAULT 1, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE TABLE wiki_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wiki_id uuid NOT NULL REFERENCES wiki_pages(id), revision integer NOT NULL, markdown text NOT NULL, source_refs jsonb NOT NULL DEFAULT '[]', origin text NOT NULL CHECK(origin IN ('user','seed','ai_draft')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(wiki_id,revision), UNIQUE(wiki_id,id));
-- statement
ALTER TABLE wiki_pages ADD CONSTRAINT wiki_current_owner FOREIGN KEY(id,current_revision_id) REFERENCES wiki_revisions(wiki_id,id) DEFERRABLE INITIALLY DEFERRED;
-- statement
CREATE TABLE curricula (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL DEFAULT '', seed_key text UNIQUE, revision integer NOT NULL DEFAULT 1, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE TABLE curriculum_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), curriculum_id uuid NOT NULL REFERENCES curricula(id), parent_id uuid, kind text NOT NULL CHECK(kind IN ('section','lesson')), title text NOT NULL, position integer NOT NULL DEFAULT 0, content_version integer NOT NULL DEFAULT 1, estimated_minutes integer CHECK(estimated_minutes>0), seed_key text UNIQUE, revision integer NOT NULL DEFAULT 1, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(curriculum_id,id), FOREIGN KEY(curriculum_id,parent_id) REFERENCES curriculum_items(curriculum_id,id), CHECK(parent_id IS NULL OR parent_id<>id));
-- statement
CREATE INDEX curriculum_order ON curriculum_items(curriculum_id,position);
-- statement
CREATE TABLE curriculum_dependencies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), curriculum_id uuid NOT NULL REFERENCES curricula(id), prerequisite_item_id uuid NOT NULL, dependent_item_id uuid NOT NULL, FOREIGN KEY(curriculum_id,prerequisite_item_id) REFERENCES curriculum_items(curriculum_id,id), FOREIGN KEY(curriculum_id,dependent_item_id) REFERENCES curriculum_items(curriculum_id,id), CHECK(prerequisite_item_id<>dependent_item_id), UNIQUE(prerequisite_item_id,dependent_item_id));
-- statement
CREATE TABLE lesson_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES curriculum_items(id), block_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('markdown','paper_reading','wiki_reading','self_explanation','exercise','checklist')), position integer NOT NULL, schema_version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL, UNIQUE(item_id,block_key));
-- statement
CREATE TABLE learning_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('paper','wiki','external')), title text NOT NULL, source_url text, paper_id uuid REFERENCES papers(id), wiki_id uuid REFERENCES wiki_pages(id), reading_scope jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', seed_key text UNIQUE, revision integer NOT NULL DEFAULT 1, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK((kind='paper' AND paper_id IS NOT NULL) OR (kind='wiki' AND wiki_id IS NOT NULL) OR (kind='external' AND source_url IS NOT NULL)));
-- statement
CREATE TABLE item_resources (item_id uuid NOT NULL REFERENCES curriculum_items(id), resource_id uuid NOT NULL REFERENCES learning_resources(id), role text NOT NULL CHECK(role IN ('required','optional','assignment')), position integer NOT NULL DEFAULT 0, PRIMARY KEY(item_id,resource_id));
-- statement
CREATE TABLE lesson_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES curriculum_items(id), content_version integer NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(item_id,content_version), UNIQUE(item_id,id));
-- statement
CREATE TABLE study_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL, lesson_revision_id uuid NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, elapsed_seconds integer NOT NULL DEFAULT 0 CHECK(elapsed_seconds>=0), reflection text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1, archived_at timestamptz, FOREIGN KEY(item_id,lesson_revision_id) REFERENCES lesson_revisions(item_id,id));
-- statement
CREATE TABLE exercise_submissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL, lesson_revision_id uuid NOT NULL, block_key text NOT NULL, session_id uuid REFERENCES study_sessions(id), answers jsonb NOT NULL DEFAULT '{}', evidence_path text, commit_ref text, result_note text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(item_id,lesson_revision_id) REFERENCES lesson_revisions(item_id,id));
-- statement
CREATE TABLE learning_progress (item_id uuid NOT NULL, lesson_revision_id uuid NOT NULL, state text NOT NULL CHECK(state IN ('not_started','in_progress','completed')), completed_at timestamptz, next_review_at timestamptz, revision integer NOT NULL DEFAULT 1, checks jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(item_id,lesson_revision_id), FOREIGN KEY(item_id,lesson_revision_id) REFERENCES lesson_revisions(item_id,id));
-- statement
CREATE TABLE seed_applications (seed_key text PRIMARY KEY, version integer NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE TABLE budget_buckets (scope text NOT NULL, period text NOT NULL, provider_id text NOT NULL DEFAULT '*', reserved_usd numeric(20,8) NOT NULL DEFAULT 0 CHECK(reserved_usd>=0), settled_usd numeric(20,8) NOT NULL DEFAULT 0 CHECK(settled_usd>=0), reserved_characters bigint NOT NULL DEFAULT 0, settled_characters bigint NOT NULL DEFAULT 0, PRIMARY KEY(scope,period,provider_id));
-- statement
CREATE TABLE provider_usage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES jobs(id), logical_call_id text NOT NULL, attempt integer NOT NULL, budget_scope text NOT NULL CHECK(budget_scope IN ('ai','translation')), budget_period text NOT NULL, budget_timezone text NOT NULL, provider_instance_id text NOT NULL, model_id text NOT NULL, status text NOT NULL, reserved_usd numeric(20,8), estimated_usd numeric(20,8), input_tokens integer, output_tokens integer, cache_read_tokens integer, cache_write_tokens integer, characters bigint, reserved_characters bigint NOT NULL DEFAULT 0, raw_usage jsonb, pricing_revision text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(logical_call_id,attempt));
-- statement
CREATE TABLE embedding_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_snapshot jsonb NOT NULL, model_revision text NOT NULL, dimensions integer NOT NULL CHECK(dimensions>0), distance text NOT NULL CHECK(distance IN ('Cosine','Dot','Euclid')), preprocessing_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE TABLE index_generations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), embedding_profile_id uuid NOT NULL REFERENCES embedding_profiles(id), collection_name text NOT NULL UNIQUE, state text NOT NULL CHECK(state IN ('building','active','retired','failed')), corpus_manifest jsonb NOT NULL, activated_at timestamptz);
-- statement
CREATE UNIQUE INDEX one_active_index ON index_generations((state)) WHERE state='active';
-- statement
CREATE FUNCTION reject_immutable_edit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable revision'; END $$;
-- statement
CREATE TRIGGER immutable_wiki_revision BEFORE UPDATE OR DELETE ON wiki_revisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_edit();
-- statement
CREATE TRIGGER immutable_lesson_revision BEFORE UPDATE OR DELETE ON lesson_revisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_edit();
-- statement
CREATE TRIGGER immutable_segment BEFORE UPDATE OR DELETE ON paper_segments FOR EACH ROW EXECUTE FUNCTION reject_immutable_edit();
-- statement
CREATE TRIGGER immutable_artifact BEFORE UPDATE OR DELETE ON generated_artifacts FOR EACH ROW EXECUTE FUNCTION reject_immutable_edit();
-- statement
CREATE FUNCTION validate_curriculum_item() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE parent_kind text; parent_parent uuid; BEGIN
 PERFORM id FROM curricula WHERE id=NEW.curriculum_id FOR UPDATE;
 IF NEW.parent_id IS NOT NULL THEN
 SELECT kind,parent_id INTO parent_kind,parent_parent FROM curriculum_items WHERE id=NEW.parent_id AND curriculum_id=NEW.curriculum_id;
 IF parent_kind IS DISTINCT FROM 'section' OR parent_parent IS NOT NULL OR NEW.kind<>'lesson' THEN RAISE EXCEPTION 'parent must be a same-curriculum top-level section'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'item kind is immutable'; END IF;
 RETURN NEW; END $$;
-- statement
CREATE TRIGGER curriculum_item_shape BEFORE INSERT OR UPDATE ON curriculum_items FOR EACH ROW EXECUTE FUNCTION validate_curriculum_item();
-- statement
CREATE FUNCTION validate_dependency() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM id FROM curricula WHERE id=NEW.curriculum_id FOR UPDATE;
 IF (SELECT count(*) FROM curriculum_items WHERE id IN (NEW.prerequisite_item_id,NEW.dependent_item_id) AND curriculum_id=NEW.curriculum_id AND kind='lesson' AND archived_at IS NULL)<>2 THEN RAISE EXCEPTION 'dependency endpoints must be active lessons'; END IF;
 IF EXISTS(WITH RECURSIVE reachable(id) AS (SELECT NEW.dependent_item_id UNION SELECT d.dependent_item_id FROM curriculum_dependencies d JOIN reachable r ON d.prerequisite_item_id=r.id WHERE d.curriculum_id=NEW.curriculum_id AND d.id<>NEW.id) SELECT 1 FROM reachable WHERE id=NEW.prerequisite_item_id) THEN RAISE EXCEPTION 'dependency cycle'; END IF;
 RETURN NEW; END $$;
-- statement
CREATE TRIGGER dependency_dag BEFORE INSERT OR UPDATE ON curriculum_dependencies FOR EACH ROW EXECUTE FUNCTION validate_dependency();
-- statement
CREATE FUNCTION validate_lesson_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT kind FROM curriculum_items WHERE id=NEW.item_id) IS DISTINCT FROM 'lesson' THEN RAISE EXCEPTION 'only lessons own blocks'; END IF; RETURN NEW; END $$;
-- statement
CREATE TRIGGER lesson_block_owner BEFORE INSERT OR UPDATE ON lesson_blocks FOR EACH ROW EXECUTE FUNCTION validate_lesson_block();
