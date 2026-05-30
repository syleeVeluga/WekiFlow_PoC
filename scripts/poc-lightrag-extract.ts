import { TripletArraySchema } from '@wf/shared';
import { extractTripletsDeterministic } from '@wf/agent-tools';

const sample = `
연차 규정 제4조 2항: 신입사원은 입사와 동시에 연차 15일을 부여받는다.
연차 사용 신청은 부서장의 결재를 받아야 한다.
`;

const first = TripletArraySchema.parse(extractTripletsDeterministic(sample));
const second = TripletArraySchema.parse(extractTripletsDeterministic(sample));

const hasAnnualLeave = first.triplets.some(
  (triplet) => triplet.subject === '신입사원' && triplet.object === '연차 15일',
);
const hasApprover = first.triplets.some(
  (triplet) => triplet.subject === '연차 사용 신청' && triplet.object === '부서장',
);
const stable = JSON.stringify(first) === JSON.stringify(second);

if (!hasAnnualLeave || !hasApprover || !stable) {
  console.error(JSON.stringify({ first, second, hasAnnualLeave, hasApprover, stable }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(first, null, 2));
console.log('LightRAG extraction PoC passed: schema-valid and stable');
