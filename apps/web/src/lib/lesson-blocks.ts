import type { BlockKind, LessonBlock } from "./types";
export const blockDefinitions: Record<
  BlockKind,
  {
    label: string;
    field: string;
    list?: boolean;
    validate: (payload: Record<string, unknown>) => boolean;
  }
> = {
  markdown: {
    label: "개념 설명",
    field: "markdown",
    validate: (p) => typeof p.markdown === "string",
  },
  paper_reading: {
    label: "논문 읽기",
    field: "paperId",
    validate: (p) =>
      typeof p.paperId === "string" || typeof p.resourceId === "string",
  },
  wiki_reading: {
    label: "위키 읽기",
    field: "wikiId",
    validate: (p) =>
      typeof p.wikiId === "string" || typeof p.resourceId === "string",
  },
  self_explanation: {
    label: "자기 설명",
    field: "questions",
    list: true,
    validate: (p) =>
      Array.isArray(p.questions) &&
      p.questions.every((q) => typeof q === "string"),
  },
  exercise: {
    label: "작은 실습",
    field: "instructions",
    validate: (p) => typeof p.instructions === "string",
  },
  checklist: {
    label: "완료 확인",
    field: "items",
    list: true,
    validate: (p) =>
      Array.isArray(p.items) && p.items.every((q) => typeof q === "string"),
  },
};
export function supportedBlock(
  block: LessonBlock,
): block is LessonBlock & { kind: BlockKind } {
  return (
    block.schemaVersion === 1 &&
    Object.hasOwn(blockDefinitions, block.kind) &&
    blockDefinitions[block.kind as BlockKind].validate(block.payload)
  );
}
export function newBlock(kind: BlockKind, key: string): LessonBlock {
  const def = blockDefinitions[kind];
  return {
    blockKey: key,
    kind,
    schemaVersion: 1,
    payload: { [def.field]: def.list ? [] : "" },
  };
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length)
    return items;
  const result = [...items];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}
