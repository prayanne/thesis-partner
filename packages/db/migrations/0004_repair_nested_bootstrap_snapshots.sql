-- Restore structured fields embedded inside early lesson snapshots without altering prose.
CREATE FUNCTION decode_bootstrap_json(value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF jsonb_typeof(value)='string' AND (left(ltrim(value #>> '{}'),1) IN ('{','[') OR value #>> '{}'='null') THEN RETURN (value #>> '{}')::jsonb; END IF;
 RETURN value;
 EXCEPTION WHEN invalid_text_representation THEN RETURN value;
END $$;
-- statement
ALTER TABLE lesson_revisions DISABLE TRIGGER immutable_lesson_revision;
-- statement
UPDATE lesson_revisions r SET snapshot=jsonb_set(jsonb_set(r.snapshot,'{blocks}',
 coalesce((SELECT jsonb_agg(CASE WHEN b ? 'payload' THEN jsonb_set(b,'{payload}',decode_bootstrap_json(b->'payload')) ELSE b END ORDER BY ord) FROM jsonb_array_elements(r.snapshot->'blocks') WITH ORDINALITY AS valueset(b,ord)),'[]'::jsonb)),
 '{resources}',coalesce((SELECT jsonb_agg(jsonb_set(jsonb_set(resource,'{readingScope}',coalesce(decode_bootstrap_json(resource->'readingScope'),'{}'::jsonb)),'{metadata}',coalesce(decode_bootstrap_json(resource->'metadata'),'{}'::jsonb)) ORDER BY ord) FROM jsonb_array_elements(r.snapshot->'resources') WITH ORDINALITY AS resourceset(resource,ord)),'[]'::jsonb)) || '{"warnings":["Legacy bootstrap snapshot JSON restored; original linked revision IDs may be absent."]}'::jsonb
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot->'blocks') b WHERE jsonb_typeof(b->'payload')='string')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot->'resources') resource WHERE jsonb_typeof(resource->'readingScope')='string' OR jsonb_typeof(resource->'metadata')='string');
-- statement
ALTER TABLE lesson_revisions ENABLE TRIGGER immutable_lesson_revision;
-- statement
DROP FUNCTION decode_bootstrap_json(jsonb);
