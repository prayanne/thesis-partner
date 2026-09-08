-- Early native postgres.js transport encoded already serialized JSON a second time.
-- Repair only structured JSON columns with an encoded object/array/null; user text columns are untouched.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND udt_name='jsonb' ORDER BY table_name,column_name LOOP
  EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER',c.table_name);
  EXECUTE format('UPDATE %I SET %I=(%I #>> ''{}'')::jsonb WHERE jsonb_typeof(%I)=''string'' AND (left(ltrim(%I #>> ''{}''),1) IN (''{'',''['') OR (%I #>> ''{}'')=''null'')',c.table_name,c.column_name,c.column_name,c.column_name,c.column_name,c.column_name);
  EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER',c.table_name);
 END LOOP;
END $$;
