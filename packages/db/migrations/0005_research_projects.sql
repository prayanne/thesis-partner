CREATE TABLE research_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL,
 domain text NOT NULL,
 description text NOT NULL DEFAULT '',
 summary_markdown text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
 revision integer NOT NULL DEFAULT 1,
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE TABLE project_materials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES research_projects(id),
 kind text NOT NULL CHECK(kind IN ('paper','wiki','link','note')),
 title text NOT NULL,
 paper_id uuid REFERENCES papers(id),
 wiki_id uuid REFERENCES wiki_pages(id),
 source_url text,
 content text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '',
 position integer NOT NULL DEFAULT 0,
 revision integer NOT NULL DEFAULT 1,
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(
   (kind='paper' AND paper_id IS NOT NULL AND wiki_id IS NULL AND source_url IS NULL) OR
   (kind='wiki' AND wiki_id IS NOT NULL AND paper_id IS NULL AND source_url IS NULL) OR
   (kind='link' AND source_url IS NOT NULL AND paper_id IS NULL AND wiki_id IS NULL) OR
   (kind='note' AND paper_id IS NULL AND wiki_id IS NULL AND source_url IS NULL)
 )
);
-- statement
CREATE INDEX project_material_order ON project_materials(project_id,position,created_at);
-- statement
CREATE UNIQUE INDEX project_material_paper_unique ON project_materials(project_id,paper_id) WHERE kind='paper' AND archived_at IS NULL;
-- statement
CREATE UNIQUE INDEX project_material_wiki_unique ON project_materials(project_id,wiki_id) WHERE kind='wiki' AND archived_at IS NULL;
