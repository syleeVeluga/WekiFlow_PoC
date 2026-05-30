import { generateObject } from 'ai';
import { MockLanguageModelV3, mockValues } from 'ai/test';
import { TripletArraySchema } from '@wf/shared';

const sample = `
연차 규정 제4조 2항: 신입사원은 입사와 동시에 연차 15일을 부여받는다.
연차 사용 신청은 부서장의 결재를 받아야 한다.
`;

const expected = {
  triplets: [
    {
      subject: '신입사원',
      predicate: '부여받는다',
      object: '연차 15일',
      subjectType: 'PERSON',
      objectType: 'REGULATION',
      strength: 0.9,
    },
    {
      subject: '연차 사용 신청',
      predicate: '결재권자',
      object: '부서장',
      subjectType: 'POLICY',
      objectType: 'PERSON',
      strength: 0.95,
    },
  ],
};

const model = new MockLanguageModelV3({
  doGenerate: mockValues({
    content: [{ type: 'text', text: JSON.stringify(expected) }],
    finishReason: 'stop',
    usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
    warnings: [],
  }),
} as never);

async function extractTriplets() {
  const { object } = await generateObject({
    model,
    schema: TripletArraySchema,
    system: `너는 지식 추출기다. (Subject)-[Predicate]->(Object) JSON 배열로 추출하라.
모호한 대명사는 원본 명사로 치환하고, 각 관계에 strength(0~1)와 엔티티 type을 부여하라.
명시된 사실만 추출하고 추론은 금지한다.`,
    prompt: sample,
  });
  return TripletArraySchema.parse(object);
}

// NOTE: the model is mocked, so this validates the generateObject + TripletArraySchema
// wiring (the SDK parses the model's text into a schema-valid object and surfaces it),
// not real extraction quality or determinism.
const extracted = await extractTriplets();

const hasAnnualLeave = extracted.triplets.some(
  (triplet) => triplet.subject === '신입사원' && triplet.object === '연차 15일',
);
const hasApprover = extracted.triplets.some(
  (triplet) => triplet.subject === '연차 사용 신청' && triplet.object === '부서장',
);

if (!hasAnnualLeave || !hasApprover) {
  console.error(JSON.stringify({ extracted, hasAnnualLeave, hasApprover }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(extracted, null, 2));
console.log('LightRAG extraction PoC passed: generateObject output is schema-valid (mock model)');
