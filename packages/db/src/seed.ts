import { pathToFileURL } from "node:url";
import { getDatabase, type Database } from "./client";
import { migrate } from "./migrations";
import { saveWiki, saveItem, createResource } from "../../domain/src/learning";
import { json, one } from "../../domain/src/common";

const lessons = [
  {
    key: "algorithms",
    title: "자료구조·알고리즘",
    paper: "A Note on Two Problems in Connexion with Graphs",
    authors: ["Edsger W. Dijkstra"],
    year: 1959,
    url: "https://jmvidal.cse.sc.edu/lib/dijkstra59a.html",
    scope: "문제 정의와 최단 경로 알고리즘",
    textbook:
      "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/",
    reading: "복잡도·자료구조·그래프 노트",
    exercise:
      "가중 그래프 최단 경로 CLI를 만드세요. 정상·도달 불가·동일 비용 사례를 테스트하고 음수 간선 제약과 복잡도를 설명하세요.",
    checks: [
      "정상 경로의 비용 확인",
      "도달 불가 처리",
      "동일 비용 경로 허용",
      "음수 간선 제약 설명",
    ],
    wikis: [2, 3, 4],
  },
  {
    key: "modules",
    title: "모듈 설계·테스트",
    paper: "On the Criteria To Be Used in Decomposing Systems into Modules",
    authors: ["David L. Parnas"],
    year: 1972,
    url: "https://doi.org/10.1145/361598.361623",
    scope: "두 분해 방법과 정보 은닉 판단 기준",
    textbook: "https://web.mit.edu/6.031/www/sp21/",
    reading: "Testing, Specifications, ADT, Interfaces",
    exercise:
      "작은 논문 목록 CLI의 메모리 저장소와 JSON 저장소를 교체하세요. 호출부를 수정하지 않고 같은 동작 테스트를 통과시키고 숨긴 설계 결정 두 개를 설명하세요.",
    checks: [
      "두 저장소의 공통 동작 테스트",
      "호출부 변경 없음",
      "숨긴 결정 두 개 기록",
    ],
    wikis: [5, 6, 7],
  },
  {
    key: "systems",
    title: "컴퓨터 시스템·OS",
    paper: "The UNIX Time-Sharing System",
    authors: ["Dennis M. Ritchie", "Ken Thompson"],
    year: 1974,
    url: "https://www.cs.cmu.edu/~15712/papers/ritchie74.pdf",
    scope: "파일·프로세스·shell",
    textbook: "https://pages.cs.wisc.edu/~remzi/OSTEP/",
    reading:
      "Processes, Process API, Address Spaces, Files and Directories; Threads 보충",
    exercise:
      "두 자식 프로세스를 pipe로 연결하는 명령 실행기를 만드세요. 시작·대기·종료와 실행 실패를 처리하고 열린 파일 디스크립터 흐름을 그리세요.",
    checks: [
      "두 자식 프로세스 연결",
      "필요 없는 FD 닫기",
      "실행 실패 상태 기록",
      "자식 종료 대기",
    ],
    wikis: [8, 9, 10],
  },
  {
    key: "networks",
    title: "네트워크·신뢰성",
    paper: "End-to-End Arguments in System Design",
    authors: ["Jerome H. Saltzer", "David P. Reed", "David D. Clark"],
    year: 1984,
    url: "https://web.mit.edu/Saltzer/www/publications/endtoend/endtoend.pdf",
    scope: "파일 전송 사례와 설계 논증",
    textbook: "https://intronetworks.cs.luc.edu/",
    reading: "계층·IP·TCP·socket",
    exercise:
      "localhost 파일 전송을 구현하고 수신자의 저장 완료 응답과 checksum을 검증하세요. 저장 실패를 성공으로 표시하지 말고 응답 전에 연결이 끊긴 경우를 기록하세요.",
    checks: ["파일 checksum 일치", "저장 실패 응답", "연결 중단의 불확실 상태"],
    wikis: [11, 12],
  },
  {
    key: "databases",
    title: "관계형 데이터·트랜잭션",
    paper: "A Relational Model of Data for Large Shared Data Banks",
    authors: ["Edgar F. Codd"],
    year: 1970,
    url: "https://research.ibm.com/publications/a-relational-model-of-data-for-large-shared-data-banks",
    scope: "데이터 독립성과 관계 모델",
    textbook: "https://15445.courses.cs.cmu.edu/fall2025/",
    reading: "관계 모델·SQL·index·transaction 공개 자료",
    exercise:
      "논문·저자·컬렉션 데이터베이스를 만드세요. 다대다 조회와 중복 제약을 검증하고 중간 실패 시 전체 transaction rollback을 확인하세요.",
    checks: [
      "다대다 JOIN",
      "중복 관계 거부",
      "중간 실패 rollback",
      "단일 JSON과 선택 이유",
    ],
    wikis: [13, 14, 15],
  },
  {
    key: "distributed",
    title: "분산 시스템 기초",
    paper: "Time, Clocks, and the Ordering of Events in a Distributed System",
    authors: ["Leslie Lamport"],
    year: 1978,
    url: "https://lamport.azurewebsites.net/pubs/time-clocks.pdf",
    scope: "사건 순서와 논리 시계",
    textbook: "https://pages.cs.wisc.edu/~remzi/OSTEP/",
    reading: "Distributed Systems",
    exercise:
      "한 로컬 프로그램에서 세 노드와 메시지 지연을 모사하세요. a → b이면 L(a) < L(b)를 테스트하고 역명제가 성립하지 않는 trace를 기록하세요.",
    checks: [
      "세 노드 사건 trace",
      "송신·수신 시계 갱신",
      "인과 관계 조건 확인",
      "역명제 반례",
    ],
    wikis: [16, 17],
  },
  {
    key: "security",
    title: "보안·정보 보호",
    paper: "The Protection of Information in Computer Systems",
    authors: ["Jerome H. Saltzer", "Michael D. Schroeder"],
    year: 1975,
    url: "https://www.mit.edu/~Saltzer/publications/protection/index.html",
    scope: "Section I",
    textbook: "https://textbook.cs161.org/",
    reading: "Security Principles, Passwords, Web Security 기초",
    exercise:
      "가상 로컬 설정 API의 공개/비밀 필터와 읽기 권한 검사를 구현하세요. 비허용 요청 거절, 비밀값 비노출 테스트, 데이터 흐름·위협 노트를 제출하세요.",
    checks: [
      "권한 없는 읽기 거부",
      "비밀값 응답·로그 비노출",
      "허용 범위 명시",
      "데이터 흐름과 위협 기록",
    ],
    wikis: [18, 19],
  },
];
const wikiSeeds = [
  [
    "CLI·Git·재현 가능한 실행",
    "재현 가능한 실행은 다른 시점에도 같은 입력과 환경으로 결과를 확인할 수 있도록 명령과 버전을 기록하는 작업입니다.",
    "실행 명령, 입력 파일의 hash, 언어 버전과 commit을 함께 적습니다.",
    "commit만 있으면 외부 의존성과 입력까지 보존된다는 오해를 피하세요.",
  ],
  [
    "테스트와 결과 기록",
    "테스트는 입력과 기대 결과를 명시하여 특정 동작을 반복 확인하는 절차입니다.",
    "정상 입력, 빈 입력, 잘못된 입력의 실제 결과를 기대값과 비교합니다.",
    "테스트 통과가 모든 입력에서 정확함을 증명하지는 않습니다.",
  ],
  [
    "Big-O와 자료구조 선택",
    "Big-O는 입력 크기가 커질 때 연산량의 증가를 상한으로 표현합니다.",
    "선형 검색은 원소를 하나씩 보지만 해시 조회는 적절한 가정 아래 평균적으로 일정한 횟수의 탐색을 합니다.",
    "Big-O만 같다고 실제 지연이나 메모리 사용량까지 같지는 않습니다.",
  ],
  [
    "그래프·최단 경로",
    "그래프는 정점과 간선으로 관계를 표현하며 최단 경로는 비용의 합이 최소인 경로입니다.",
    "정점 A-B 비용 2, B-C 비용 3, A-C 비용 8이면 A에서 C의 최소 비용은 5입니다.",
    "음수 간선이 있는 그래프에 Dijkstra 알고리즘의 전제를 그대로 적용하면 안 됩니다.",
  ],
  [
    "불변식",
    "불변식은 알고리즘이나 데이터 구조가 지정한 경계에서 항상 유지해야 하는 조건입니다.",
    "반복문이 처리한 접두 구간은 항상 정렬되어 있다는 조건으로 삽입 정렬을 검토합니다.",
    "중간의 모든 기계 명령마다 같은 조건이 성립해야 한다는 뜻은 아닙니다.",
  ],
  [
    "추상화·정보 은닉",
    "정보 은닉은 바뀔 가능성이 있는 설계 결정을 모듈의 인터페이스 뒤에 둡니다.",
    "저장소 인터페이스를 통해 메모리 구현과 파일 구현을 교체합니다.",
    "파일을 작게 나누는 것만으로 변경 의존성이 줄지는 않습니다.",
  ],
  [
    "인터페이스·계약",
    "인터페이스 계약은 호출자가 만족할 조건과 구현이 보장할 결과를 정의합니다.",
    "find(id)는 없을 때 null을 반환하며 읽기만 수행한다는 약속을 정합니다.",
    "같은 함수 이름이 같은 오류·부작용 계약을 보장하지는 않습니다.",
  ],
  [
    "테스트 경계",
    "테스트 경계는 한 검증에서 실제로 실행하고 관찰하는 구성요소의 범위입니다.",
    "저장소 동작 테스트는 외부 DB 없이도 계약을 검증하지만 실제 연결 권한까지 검증하지 않습니다.",
    "mock 성공을 실제 외부 시스템 성공과 같게 해석하지 마세요.",
  ],
  [
    "CPU·메모리 계층·주소 공간",
    "주소 공간은 프로세스가 메모리를 읽고 쓰는 주소의 관점이며 실제 물리 배치와 구별됩니다.",
    "연속 배열 순회가 무작위 포인터 순회보다 cache 지역성에 유리한 이유를 설명합니다.",
    "가상 주소가 물리 메모리의 직접 위치라는 오해를 피하세요.",
  ],
  [
    "프로세스와 스레드",
    "프로세스는 실행 자원과 주소 공간의 단위이며 스레드는 그 안에서 실행 흐름을 이룹니다.",
    "두 스레드는 같은 heap을 공유하므로 함께 수정하는 값에 동기화가 필요할 수 있습니다.",
    "동시 실행이 항상 동시에 CPU를 사용하는 병렬 실행은 아닙니다.",
  ],
  [
    "파일 디스크립터·파이프",
    "파일 디스크립터는 프로세스가 열린 입출력 대상을 참조하는 작은 정수입니다.",
    "자식의 표준 출력을 pipe 쓰기 끝에 연결하고 다른 자식의 표준 입력으로 읽습니다.",
    "사용하지 않는 쓰기 끝을 열어두면 읽는 쪽이 EOF를 받지 못할 수 있습니다.",
  ],
  [
    "계층·IP·TCP",
    "네트워크 계층은 서로 다른 범위의 전달 책임을 나누며 TCP는 바이트 스트림을 제공합니다.",
    "한 번 send한 데이터가 한 번 recv로 도착한다는 가정 없이 길이 또는 구분자로 메시지를 나눕니다.",
    "TCP가 응용 프로그램의 파일 저장 완료까지 보장하지는 않습니다.",
  ],
  [
    "종단 간 신뢰성",
    "종단 간 검증은 업무 성공을 판단할 정보를 가진 끝단에서 결과를 확인하는 원칙입니다.",
    "수신자는 checksum 확인과 파일 저장 후 완료 응답을 보냅니다.",
    "중간 계층의 검사는 쓸모없다는 뜻이 아닙니다. 비용과 실패 위치를 구별하세요.",
  ],
  [
    "관계·키·정규화",
    "관계 모델은 값을 가진 튜플의 집합과 제약으로 데이터를 표현합니다.",
    "저자와 논문의 다대다 관계를 별도 연결 테이블과 복합 unique 제약으로 만듭니다.",
    "정규화가 JOIN을 없애거나 모든 조회를 빠르게 만드는 규칙은 아닙니다.",
  ],
  [
    "SQL·JOIN·index",
    "JOIN은 관련 행을 조건으로 결합하고 index는 특정 탐색을 돕는 별도 구조입니다.",
    "paper_id와 author_id로 연결 테이블을 조회하고 실행 계획에서 index 사용을 확인합니다.",
    "index는 저장 공간과 쓰기 비용을 요구하며 항상 선택되지는 않습니다.",
  ],
  [
    "트랜잭션",
    "트랜잭션은 여러 데이터 변경을 정해진 원자성·격리 규칙 아래 처리합니다.",
    "논문 생성 후 저자 연결이 실패하면 두 작업을 함께 rollback합니다.",
    "DB transaction이 외부 파일과 네트워크 요청까지 함께 rollback하지는 않습니다.",
  ],
  [
    "부분 실패",
    "부분 실패는 시스템 일부가 멈추거나 연결되지 않아 다른 부분과 결과 상태가 달라지는 현상입니다.",
    "서버는 저장했지만 응답이 유실되면 클라이언트는 성공 여부를 확정하지 못합니다.",
    "timeout이 서버 미실행을 뜻하지는 않습니다.",
  ],
  [
    "인과 관계·논리 시계",
    "논리 시계는 메시지와 실행 순서가 만드는 인과 관계에 일관된 숫자를 부여합니다.",
    "수신 이벤트의 시계는 max(로컬 시계, 메시지 시계)+1로 갱신합니다.",
    "L(a)<L(b)만으로 a가 b의 원인이라고 단정할 수 없습니다.",
  ],
  [
    "최소 권한·기본 거부",
    "최소 권한은 작업에 필요한 범위만 허용하고 나머지는 기본적으로 거부하는 원칙입니다.",
    "읽기 token에는 조회 scope만 부여하고 수정 endpoint는 서버에서 거절합니다.",
    "버튼을 숨기는 것만으로 서버 권한 검사를 대체할 수 없습니다.",
  ],
  [
    "인증·인가·비밀정보",
    "인증은 요청 주체를 확인하고 인가는 해당 주체가 할 수 있는 일을 판정합니다.",
    "서버는 token을 검증한 뒤 읽기 scope를 검사하고 응답에서 API key를 제외합니다.",
    "localhost에서 실행된다는 사실만으로 모든 요청을 신뢰할 수는 없습니다.",
  ],
];

export async function applySeed(db: Database) {
  return db.transaction(async (tx) => {
    await tx.query("LOCK TABLE seed_applications IN SHARE ROW EXCLUSIVE MODE");
    const [existing] = await tx.query(
      "SELECT * FROM seed_applications WHERE seed_key='cs-foundations'",
    );
    if (existing) return { applied: false, version: existing.version };
    const wikiIds: string[] = [];
    for (const [index, entry] of wikiSeeds.entries()) {
      const [title, definition, example, misconception] = entry;
      const markdown = `# ${title}\n\n## 한 문장 정의\n${definition}\n\n## 선수 개념\n함수·조건문·반복문과 간단한 터미널 실행\n\n## 작은 예시\n${example}\n\n## 흔한 오해\n${misconception}\n\n## 연결 자료와 관련 단원\n관련 커리큘럼의 지정 교재와 원문 링크를 확인하세요. 이 글은 서비스용 학습 초안이며 논문 인용을 대신하지 않습니다.\n\n## 자기 설명\n이 개념을 자신의 실습에 적용하고 실패 사례 하나를 설명하세요.\n`;
      const page = await saveWiki(
        tx,
        { title, slug: `cs-${index + 1}`, markdown },
        undefined,
        "seed",
      );
      await tx.query("UPDATE wiki_pages SET seed_key=$2 WHERE id=$1", [
        page.id,
        `cs-wiki-${index + 1}`,
      ]);
      wikiIds.push(page.id);
    }
    const curriculum = await one(
      tx,
      "INSERT INTO curricula(title,description,seed_key) VALUES('개발자를 위한 CS 기초','기초 Wiki → 공개 교재 → 논문 지정 구간 → 자기 설명 → 작은 실습 → 회고와 완료','cs-foundations') RETURNING *",
    );
    const itemIds: string[] = [];
    for (const [index, lesson] of lessons.entries()) {
      const paper = await one(
        tx,
        "INSERT INTO papers(title,metadata) VALUES($1,$2) RETURNING *",
        [
          lesson.paper,
          json({
            authors: lesson.authors,
            year: lesson.year,
            sourceUrl: lesson.url,
            sourceStatus: "unlinked",
            seedKey: `cs-paper-${lesson.key}`,
          }),
        ],
      );
      const resource = await createResource(tx, {
        kind: "external",
        title: lesson.paper,
        sourceUrl: lesson.url,
        readingScope: { description: lesson.scope },
        metadata: {
          authors: lesson.authors,
          year: lesson.year,
          seedPaperId: paper.id,
          availability: "metadata_or_public_link",
          linkVerifiedAt: "2026-09-08",
          pdfLinked: false,
        },
      });
      const textbook = await createResource(tx, {
        kind: "external",
        title: `${lesson.title} 선행 교재`,
        sourceUrl: lesson.textbook,
        readingScope: { description: lesson.reading },
      });
      const wikiResources = [];
      for (const wi of lesson.wikis)
        wikiResources.push(
          await createResource(tx, {
            kind: "wiki",
            title: wikiSeeds[wi]![0],
            wikiId: wikiIds[wi],
            readingScope: { description: "정의·예시·오해·자기 설명" },
          }),
        );
      const item = await saveItem(tx, curriculum.id, {
        title: `${index + 1}. ${lesson.title}`,
        estimatedMinutes: 120,
        blocks: [
          {
            blockKey: "intro",
            kind: "markdown",
            payload: {
              markdown: `## 이번 단원\n${lesson.title}의 설계 이유를 읽고 작은 프로그램에서 확인합니다.\n\n지정 범위: ${lesson.scope}\n\n실습은 사용자의 에디터에서 수행하며 이 앱은 제출 경로를 실행하지 않습니다.`,
            },
          },
          ...lesson.wikis.map((wi, n) => ({
            blockKey: `wiki-${n}`,
            kind: "wiki_reading",
            payload: { wikiId: wikiIds[wi], title: wikiSeeds[wi]![0] },
          })),
          {
            blockKey: "reading",
            kind: "markdown",
            payload: {
              markdown: `## 지정 읽기\n[${lesson.paper}](${lesson.url}) — ${lesson.scope}\n\n[선행 교재](${lesson.textbook}) — ${lesson.reading}\n\n외부 링크로 이동합니다. 원문 PDF는 자동 다운로드하지 않으며 현재 로컬 원문은 미연결입니다.`,
            },
          },
          {
            blockKey: "questions",
            kind: "self_explanation",
            payload: {
              questions: [
                "핵심 개념을 자신의 말과 작은 예시로 설명하세요.",
                "지정 논문의 어떤 절이나 논증이 설계 판단을 뒷받침하나요?",
                "실습에서 판단이 달라지는 조건 또는 실패 사례는 무엇인가요?",
              ],
            },
          },
          {
            blockKey: "exercise",
            kind: "exercise",
            payload: {
              title: `${lesson.title} 실습`,
              instructions: lesson.exercise,
              deliverables: [
                "실행 환경과 명령",
                "코드 경로 또는 commit",
                "정상·실패 결과",
                "짧은 회고",
              ],
            },
          },
          {
            blockKey: "checks",
            kind: "checklist",
            payload: { items: lesson.checks },
          },
        ],
        resources: [
          { resourceId: resource.id, role: "required" },
          { resourceId: textbook.id, role: "required" },
          ...wikiResources.map((r) => ({ resourceId: r.id, role: "required" })),
        ],
      });
      await tx.query("UPDATE curriculum_items SET seed_key=$2 WHERE id=$1", [
        item.id,
        `cs-lesson-${lesson.key}`,
      ]);
      itemIds.push(item.id);
    }
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 4],
      [2, 4],
      [2, 5],
      [3, 5],
      [4, 5],
      [1, 6],
      [2, 6],
      [3, 6],
    ])
      await tx.query(
        "INSERT INTO curriculum_dependencies(curriculum_id,prerequisite_item_id,dependent_item_id) VALUES($1,$2,$3)",
        [curriculum.id, itemIds[a!]!, itemIds[b!]!],
      );
    await tx.query(
      "INSERT INTO seed_applications(seed_key,version) VALUES('cs-foundations',1)",
    );
    return {
      applied: true,
      version: 1,
      curriculumId: curriculum.id,
      lessons: itemIds.length,
      wikiPages: wikiIds.length,
      papers: lessons.length,
    };
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const db = getDatabase();
  try {
    await migrate(db);
    console.log(JSON.stringify(await applySeed(db)));
  } finally {
    await db.close();
  }
}
