CREATE TRIGGER immutable_chunk BEFORE UPDATE OR DELETE ON paper_chunks FOR EACH ROW EXECUTE FUNCTION reject_immutable_edit();
-- statement
CREATE TRIGGER immutable_analysis BEFORE UPDATE OR DELETE ON paper_analyses FOR EACH ROW EXECUTE FUNCTION reject_immutable_edit();
-- statement
ALTER TABLE generated_artifacts ADD CONSTRAINT artifact_key_owner UNIQUE(logical_key,id);
-- statement
ALTER TABLE cache_entries ADD CONSTRAINT cache_artifact_owner FOREIGN KEY(logical_key,current_artifact_id) REFERENCES generated_artifacts(logical_key,id);
-- statement
ALTER TABLE study_sessions ADD CONSTRAINT study_session_owner UNIQUE(item_id,lesson_revision_id,id);
-- statement
ALTER TABLE study_sessions ADD CONSTRAINT valid_study_times CHECK(ended_at IS NULL OR ended_at>=started_at);
-- statement
ALTER TABLE exercise_submissions ADD CONSTRAINT submission_session_owner FOREIGN KEY(item_id,lesson_revision_id,session_id) REFERENCES study_sessions(item_id,lesson_revision_id,id);
-- statement
CREATE FUNCTION validate_lesson_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (SELECT kind FROM curriculum_items WHERE id=NEW.item_id) IS DISTINCT FROM 'lesson' THEN RAISE EXCEPTION 'only lessons have learning revisions'; END IF;
 RETURN NEW; END $$;
-- statement
CREATE TRIGGER lesson_revision_owner BEFORE INSERT ON lesson_revisions FOR EACH ROW EXECUTE FUNCTION validate_lesson_revision();
-- statement
CREATE FUNCTION validate_submission_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM lesson_revisions r, jsonb_array_elements(r.snapshot->'blocks') b WHERE r.id=NEW.lesson_revision_id AND r.item_id=NEW.item_id AND b->>'blockKey'=NEW.block_key AND b->>'kind'='exercise') THEN RAISE EXCEPTION 'exercise block is absent from lesson snapshot'; END IF;
 RETURN NEW; END $$;
-- statement
CREATE TRIGGER submission_snapshot_block BEFORE INSERT OR UPDATE ON exercise_submissions FOR EACH ROW EXECUTE FUNCTION validate_submission_block();
-- statement
CREATE FUNCTION preserve_completed_extraction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state='succeeded' THEN RAISE EXCEPTION 'completed extraction is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END $$;
-- statement
CREATE TRIGGER immutable_completed_extraction BEFORE UPDATE OR DELETE ON extraction_runs FOR EACH ROW EXECUTE FUNCTION preserve_completed_extraction();
