// AUTO-GENERATED seed fixture for V WIKI PoC.
// Keep this file parse-safe UTF-8; content richness is handled by deterministic templates below.
import type { KnowledgeItem } from './types.js';

const topicNames = [
  '법인카드',
  '출장·정산',
  '사무환경',
  '복리후생',
  '근태·휴가',
  '급여·정산',
  '채용·온보딩',
  '장비·소프트웨어',
  '사내시스템',
  '보안·권한',
  '미분류',
] as const;

const departments = ['총무팀', '인사팀', 'IT팀', '재무팀', '영업팀'] as const;
const authors = ['이지수', '박민지', '김하윤', '최서연', '한도윤'] as const;
const sourceLabels = ['Slack #운영문의', 'Notion 운영규정', 'Email 공지', '관리자 수기 입력'] as const;
const tagPool = ['정산', '승인', 'FAQ', '보안', '복지', '입사', '장비', '휴가', 'AI추천'] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function itemTitle(category: string, n: number): string {
  const subjects = ['기준', '신청 절차', '예외 처리', '승인 흐름', 'FAQ', '담당자 안내', '변경 이력', '주의사항'];
  return `${category} ${subjects[n % subjects.length]} ${pad(n)}`;
}

export const SEED_KNOWLEDGE_ITEMS: KnowledgeItem[] = Array.from({ length: 88 }, (_, index) => {
  const n = index + 1;
  const id = `k${pad(n)}`;
  const category = topicNames[index % topicNames.length]!;
  const department = departments[index % departments.length]!;
  const authorName = authors[index % authors.length]!;
  const title = itemTitle(category, n);
  const freshness = n % 17 === 0 ? 'conflict' : n % 5 === 0 ? 'needs_update' : 'latest';
  const updatedAtLabel = n < 8 ? '오늘' : `2026.05.${pad(((n - 1) % 28) + 1)}`;

  return {
    id,
    documentId: `doc-${id}`,
    title,
    summary: `${department}에서 자주 확인하는 ${category} 운영 기준과 처리 절차입니다.`,
    contentMarkdown: [
      `# ${title}`,
      '',
      '## 핵심 기준',
      `- 담당 부서: ${department}`,
      `- 적용 범위: ${category} 관련 전사 공통 운영`,
      '- 요청 내용과 근거 자료를 먼저 확인합니다.',
      '- 담당자가 기준을 검토한 뒤 승인 또는 반려합니다.',
      '',
      '## 처리 절차',
      '1. 요청자가 필요한 정보를 등록합니다.',
      '2. 담당자가 기준과 증빙을 확인합니다.',
      '3. 승인된 내용은 V WIKI에 반영합니다.',
    ].join('\n'),
    department,
    category,
    freshness,
    usageCount: 12 + ((n * 7) % 90),
    modCount: n % 4,
    sourceLabel: sourceLabels[n % sourceLabels.length]!,
    authorName,
    updatedAtLabel,
    aiTags: [tagPool[n % tagPool.length]!, tagPool[(n + 3) % tagPool.length]!],
    origin: {
      label: '최초 등록',
      at: '2026-05-01',
      by: authorName,
      source: '시드 데이터',
    },
    lastChange: {
      label: freshness === 'latest' ? '검토 완료' : '검토 필요',
      at: '2026-05-30',
      by: 'LORE',
      source: '자동 감지',
    },
  };
});
