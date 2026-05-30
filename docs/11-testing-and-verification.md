# 11. 테스트 & 검증 (Testing & Verification)

> PRD "실행 제안"이 **본격 개발 전 가장 먼저 테스트하라**고 강조한 2대 코어 PoC를 포함합니다.
> *Includes the two core PoC scripts the PRD recommends building first.*

---

## 0. 테스트 전략 (Strategy)

| 레벨 | 도구 | 대상 |
| :--- | :--- | :--- |
| 단위(Unit) | `vitest` | repo, 정규화 함수, 청킹, 트리플 파서, RRF 융합 |
| 통합(Integration) | `vitest` + 로컬 인프라 | 큐 흐름, 샌드박스 실행, $vectorSearch/$graphLookup |
| E2E(Smoke) | 스크립트/Playwright(선택) | 인입→검토→승인→그래프 선순환 |
| 코어 PoC | tsx 스크립트 | ① 샌드박스 grep, ② LightRAG 추출 (아래) |

> **결정론적 테스트 원칙**: LLM 호출이 들어가는 테스트는 가능한 한 `generateObject`+스키마로 출력을 구조화하고, 어서션은 구조/존재 여부 중심으로. 정확도 평가는 별도 eval 트랙(RAGAS 등).

---

## A. 코어 PoC ① — E2B 대체: 샌드박스 grep 실행 테스트

> PRD: *"에이전트가 터미널 도구를 호출해 직접 grep을 실행하는 TypeScript 코드."* (격리 Docker로 구현)

목적: 에이전트가 `tool_execute_sandbox_terminal`을 호출해, 격리 컨테이너에서 대상 MD를 `rg`로 정확히 탐색하고 결과를 받아오는지 검증.

```ts
// scripts/poc-sandbox-grep.ts   (실행: pnpm tsx scripts/poc-sandbox-grep.ts)
import { Agent, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { DockerSandboxRunner } from '@wf/sandbox';
import { makeSandboxTool } from '@wf/agent-tools';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function main() {
  // 1) 테스트용 문서 스냅샷 디렉터리 준비
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-docs-'));
  await fs.writeFile(path.join(dir, 'leave.md'),
    '# 휴가 규정\n제4조 2항: 신입사원은 입사 시 연차 15일을 부여받는다.\n');

  // 2) 샌드박스 러너 + 도구
  const sandbox = new DockerSandboxRunner({ image: 'wekiflow/sandbox:latest' });
  const tool = makeSandboxTool({ sandbox, docsSnapshotDir: dir });

  // 3) 에이전트가 자율적으로 grep을 선택하도록
  const agent = new Agent({
    model: openai(process.env.AGENT_MODEL!),
    system: '확실치 않으면 tool_execute_sandbox_terminal로 rg를 실행해 원문을 직접 확인하라.',
    tools: { tool_execute_sandbox_terminal: tool },
    stopWhen: stepCountIs(5),
  });

  const res = await agent.generate({
    prompt: '제4조 2항에서 신입사원이 부여받는 연차 일수를 원문에서 정확히 확인해줘.',
  });

  console.log(res.text);                  // 기대: "15일"이 근거 라인과 함께 등장
}
main();
```

**✅ 통과 기준:**
- 에이전트가 실제로 샌드박스 도구를 호출(스텝 로그에 grep/rg 명령).
- stdout에 `제4조 2항 ... 연차 15일` 라인이 정확히 캡처됨.
- 격리 검증: 컨테이너에서 `curl https://example.com` 실행 시 **네트워크 차단으로 실패**.
- 호출 후 `docker ps -a`에 잔존 컨테이너 없음(일회성).

---

## B. 코어 PoC ② — LightRAG 추출 프롬프트 테스트

> PRD: *"사내 규정 텍스트를 넣었을 때 유효한 [Entity-Relation-Entity] JSON을 뱉어내는지 확인하는 파이프라인."*

```ts
// scripts/poc-lightrag-extract.ts   (실행: pnpm tsx scripts/poc-lightrag-extract.ts)
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const TripletArraySchema = z.object({
  triplets: z.array(z.object({
    subject: z.string(), predicate: z.string(), object: z.string(),
    subjectType: z.string(), objectType: z.string(),
    strength: z.number().min(0).max(1),
  })),
});

const SAMPLE = `
연차 규정 제4조 2항: 신입사원은 입사와 동시에 연차 15일을 부여받는다.
연차 사용 신청은 부서장의 결재를 받아야 한다.
`;

async function main() {
  const { object } = await generateObject({
    model: openai(process.env.AGENT_MODEL!),
    schema: TripletArraySchema,
    system: `너는 지식 추출기다. (Subject)-[Predicate]->(Object) JSON 배열로 추출하라.
모호한 대명사는 원본 명사로 치환하고, 각 관계에 strength(0~1)와 엔티티 type을 부여하라.
명시된 사실만 추출하고 추론은 금지한다.`,
    prompt: SAMPLE,
  });

  console.dir(object, { depth: null });
  // 기대 예시:
  // (신입사원)-[부여받는다]->(연차 15일)  strength≈0.9
  // (연차 사용 신청)-[결재권자]->(부서장) strength≈0.95
}
main();
```

**✅ 통과 기준:**
- 출력이 `TripletArraySchema`에 100% 부합(스키마 검증 통과).
- "신입사원→연차 15일", "→부서장 결재" 관계가 추출됨.
- 대명사/모호 표현이 원본 명사로 치환됨.
- 동일 입력 반복 시 핵심 트리플이 안정적으로 재현(구조 수준).

---

## C. 통합 테스트 시나리오 (Integration)

1. **큐 흐름**: `/api/ingest` → Main Queue → Worker → REVIEW (상태 전이 어서션).
2. **샌드박스 격리**: 네트워크/메모리/시간 제한이 실제 적용되는지(의도적 위반 케이스).
3. **벡터 검색**: 알려진 청크가 top-k에 등장하는지(Phase 0 §3 선택 구현체 기준).
4. **그래프 순회**: 시드 트리플 적재 후 2홉 질의가 기대 경로 반환.
5. **선순환 E2E**: 문서1 승인→그래프 적재→문서2 병합이 그래프 컨텍스트 활용.

---

## D. 검증 자동화 & 게이트 (CI Gates)

- [ ] `pnpm -r typecheck` (전 패키지 타입 통과)
- [ ] `pnpm -r test` (vitest 단위/통합)
- [ ] `pnpm tsx scripts/poc-sandbox-grep.ts` 통과
- [ ] `pnpm tsx scripts/poc-lightrag-extract.ts` 통과
- [ ] lint/format 통과(`eslint`, `prettier --check`)

> 각 Phase 문서의 "완료 기준(DoD)"을 머지 게이트로 사용한다.
