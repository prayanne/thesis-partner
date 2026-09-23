export interface Paper {
  archivedAt?: string | null;
  id: string;
  title: string;
  revision: number;
  doi?: string | null;
  tags?: string[];
  abstract?: string | null;
  readingStatus?: string;
  currentRevisionId?: string | null;
  currentRevision?: {
    id: string;
    activeExtractionId?: string;
    pageCount?: number;
    state?: string;
  };
  metadata?: { authors?: string[]; year?: number };
  createdAt?: string;
  relativePath?: string;
  state?: string;
}
export type Range = { start: number; end: number };
export type PdfRect = [number, number, number, number];
export interface SourceAnchor {
  paperId: string;
  paperRevisionId: string;
  extractionRunId: string;
  pageNumber: number;
  segmentId: string;
  sourceRange: Range;
  rects: PdfRect[];
  coordinateSpace: "pdf-user-space-unrotated";
  pageBox?: number[];
  sourceTextHash?: string;
}
export interface Segment {
  id: string;
  paperRevisionId?: string;
  extractionRunId: string;
  pageNumber?: number;
  pageStart?: number;
  sourceText: string;
  textHash: string;
  anchors?: unknown;
  mapping?: {
    sourceRange: Range;
    items: {
      pageNumber: number;
      itemIndex: number;
      itemTextHash: string;
      itemRange: Range;
    }[];
  }[];
}
export interface Annotation {
  id: string;
  kind: string;
  text: string;
  revision: number;
  anchor?: SourceAnchor;
  color?: string;
  createdAt?: string;
}
export interface Wiki {
  archivedAt?: string | null;
  id: string;
  title: string;
  slug: string;
  markdown: string;
  revision: number;
  updatedAt?: string;
  state?: string;
}
export type ProjectStatus = "active" | "paused" | "completed";
export type ProjectMaterialKind = "paper" | "wiki" | "link" | "note";
export interface ProjectMaterial {
  id: string;
  projectId: string;
  kind: ProjectMaterialKind;
  title: string;
  paperId?: string | null;
  wikiId?: string | null;
  sourceUrl?: string | null;
  content: string;
  note: string;
  position: number;
  revision: number;
  archivedAt?: string | null;
  paper?: Pick<Paper, "id" | "title" | "abstract" | "tags" | "metadata"> & {
    archivedAt?: string | null;
  };
  wiki?: Pick<Wiki, "id" | "title" | "markdown"> & {
    archivedAt?: string | null;
  };
}
export interface ResearchProject {
  id: string;
  title: string;
  domain: string;
  description: string;
  summaryMarkdown: string;
  status: ProjectStatus;
  revision: number;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  materialCount?: number;
  paperCount?: number;
  materials?: ProjectMaterial[];
}
export type BlockKind =
  | "markdown"
  | "paper_reading"
  | "wiki_reading"
  | "self_explanation"
  | "exercise"
  | "checklist";
export interface LessonBlock {
  id?: string;
  blockKey: string;
  kind: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
}
export interface Curriculum {
  id: string;
  title: string;
  description: string;
  revision: number;
  archivedAt?: string | null;
  items?: CurriculumItem[];
  dependencies?: {
    id: string;
    prerequisiteItemId: string;
    dependentItemId: string;
  }[];
}
export interface LearningResource {
  id: string;
  title: string;
  kind: "paper" | "wiki" | "external";
  paperId?: string;
  wikiId?: string;
  sourceUrl?: string;
  readingScope?: Record<string, unknown>;
  role?: "required" | "optional" | "assignment";
}
export interface CurriculumItem {
  id: string;
  title: string;
  kind: "lesson" | "section";
  parentId?: string | null;
  revision: number;
  position: number;
  contentVersion: number;
  archivedAt?: string | null;
  lessonRevisionId?: string;
  estimatedMinutes?: number;
  blocks?: LessonBlock[];
  resources?: LearningResource[];
  progress?: {
    revision: number;
    state: string;
    lessonRevisionId: string;
    checks?: {
      blockResponses?: Record<string, string>;
      readingConfirmed: boolean;
      selfExplanationAnswers: string[];
      exerciseConfirmed: boolean;
      userConfirmed: boolean;
    };
  };
}
export interface Artifact {
  id?: string;
  artifactId?: string;
  operation?: string;
  payload: unknown;
  completedAt?: string;
  generatedAt?: string;
  provenance?: Record<string, unknown>;
}
export interface Job {
  id?: string;
  jobId?: string;
  kind?: string;
  state: string;
  progress?: number;
  errorCode?: string;
  error?: { message?: string };
  artifactId?: string;
}
