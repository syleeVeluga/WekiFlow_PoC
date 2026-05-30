import type {
  ActivityEntry,
  AiTagSuggestion,
  DailyDigest,
  KnowledgeItem,
  MultiSourceGroup,
  ReviewItem,
  Topic,
  TreeCategory,
} from './types.js';
import { SEED_KNOWLEDGE_ITEMS } from './seedKnowledge.js';

// 디자인 목업(v-wiki.html)의 주제 분류 체계. 순서가 사이드바·트리 노출 순서가 된다.
const topicNames = ['법인카드', '출장·정산', '사무환경', '복리후생', '근태·휴가', '급여·상여', '채용·온보딩', '장비·소프트웨어', '사내시스템', '보안·권한', '미분류'];

export function createSeedTopics(): Topic[] {
  return topicNames.map((name, index) => ({
    id: `topic-${index + 1}`,
    name,
    source: 'system',
    isUnclassified: name === '미분류',
    count: 0,
  }));
}

export function createSeedKnowledgeItems(): KnowledgeItem[] {
  // 호출자가 변이해도 시드 원본이 오염되지 않도록 깊은 복제본을 돌려준다.
  return SEED_KNOWLEDGE_ITEMS.map((item) => structuredClone(item));
}

export function createSeedReviews(): ReviewItem[] {
  return [
    {
      id: 'rv-1',
      changeType: 'conflict',
      certainty: 2,
      department: '인사팀',
      topicTitle: '건강검진 대상 기준',
      source: { type: 'slack', channel: '#HR공지', time: '오전 10:14', author: '박민지', authorityLevel: 'L1' },
      existing: { content: '정규직 입사 1년 후 건강검진 지원', establishedAt: '2025-11-02', by: '이지수', source: '복리후생 규정' },
      newValue: '입사 즉시 건강검진 지원',
      newContent: '신규 입사자는 입사 즉시 건강검진 대상에 포함된다.',
      diff: [
        { kind: 'del', content: '입사 1년 후 건강검진 대상' },
        { kind: 'add', content: '입사 즉시 건강검진 대상' },
      ],
      thread: {
        type: 'slack',
        channel: '#HR공지',
        date: '2026-05-30',
        messages: [
          { channel: '#HR공지', channelType: 'slack', author: '박민지', time: '10:14', content: '올해부터 신규 입사자도 즉시 건강검진 대상입니다.', authorityLevel: 'L1', highlight: true },
          { channel: '#HR공지', channelType: 'slack', author: '이지수', time: '10:20', content: '기존 위키 문서와 충돌합니다. 확인 필요합니다.', authorityLevel: 'L2' },
        ],
      },
      reason: '기존 규정과 신규 공지가 상충합니다.',
      documentId: 'k35',
      resolved: false,
    },
    {
      id: 'rv-2',
      changeType: 'update',
      certainty: 4,
      department: '총무팀',
      topicTitle: '법인카드 영수증 제출',
      source: { type: 'email', channel: 'finance@company.com', time: '오전 09:02', author: '재무팀', authorityLevel: 'L1' },
      existing: { content: '월말까지 영수증 제출', establishedAt: '2025-08-12', by: '재무팀', source: '재무 규정' },
      newValue: '사용 후 7일 이내 제출',
      newContent: '법인카드 영수증은 사용일로부터 7일 이내 제출한다.',
      diff: [
        { kind: 'del', content: '월말까지 제출' },
        { kind: 'add', content: '사용 후 7일 이내 제출' },
      ],
      thread: {
        type: 'email',
        from: 'finance@company.com',
        to: 'all@company.com',
        subj: '법인카드 증빙 제출 기한 변경',
        date: '2026-05-30',
        messages: [],
        body: '법인카드 증빙은 사용일로부터 7일 이내 제출하도록 변경됩니다.',
      },
      reason: '공식 이메일 기준 업데이트입니다.',
      documentId: 'k07',
      resolved: false,
    },
    {
      id: 'rv-3',
      changeType: 'new',
      certainty: 5,
      department: 'IT팀',
      topicTitle: 'VPN MFA 초기화 절차',
      source: { type: 'notion', channel: 'IT 운영 문서', time: '어제', author: '김도윤', authorityLevel: 'L2' },
      existing: null,
      newValue: 'MFA 초기화는 헬프데스크 승인 후 진행',
      newContent: 'VPN MFA 초기화 요청은 헬프데스크 티켓 승인 후 처리한다.',
      diff: [{ kind: 'add', content: 'VPN MFA 초기화 절차 신규 추가' }],
      thread: {
        type: 'slack',
        channel: '#it-help',
        date: '2026-05-29',
        messages: [
          { channel: '#it-help', channelType: 'slack', author: '김도윤', time: '17:20', content: 'MFA 초기화 절차를 위키에 추가해주세요.', authorityLevel: 'L2' },
        ],
      },
      reason: '문서화되지 않은 반복 문의입니다.',
      documentId: 'k72',
      resolved: false,
    },
  ];
}

export function createSeedMultiSourceGroups(): MultiSourceGroup[] {
  return [
    {
      id: 'ms-A',
      multiSourceType: 'A',
      certainty: 5,
      department: '인사팀',
      topicTitle: '경조사 지원금 — 본인 결혼',
      description: '여러 공식 채널에서 동일한 변경이 감지되었습니다.',
      sources: [
        { channel: '#복리후생', channelType: 'slack', author: '박민지', time: '09:05', content: '본인 결혼 경조사 지원금은 100만원입니다.', isBaseline: true, authorityLevel: 'L1' },
        { channel: 'Notion 복지규정', channelType: 'notion', author: '인사팀', time: '09:20', content: '동일 내용 반영 완료', authorityLevel: 'L1' },
      ],
      resolvedContent: '본인 결혼 경조사 지원금은 100만원입니다.',
      targets: [{ id: 'k30', title: '경조사 지원금 기준', current: '본인 결혼 80만원', category: '복리후생', selected: true }],
      reason: 'L1 채널 간 동일 내용',
      resolved: false,
    },
    {
      id: 'ms-B',
      multiSourceType: 'B',
      certainty: 3,
      department: '총무팀',
      topicTitle: '회의실 예약 취소 기한',
      description: '유사하지만 시간이 다른 두 버전이 감지되었습니다.',
      sources: [
        { channel: '#총무공지', channelType: 'slack', author: '이지수', time: '11:00', content: '예약 2시간 전 취소', authorityLevel: 'L2' },
        { channel: 'Email', channelType: 'email', author: '총무팀', time: '11:05', content: '예약 1시간 전 취소', authorityLevel: 'L1' },
      ],
      resolvedContent: '회의실 예약 취소는 예약 1시간 전까지 가능합니다.',
      targets: [{ id: 'k23', title: '회의실 예약 방법', current: '30분 전 취소', category: '사무환경' }],
      reason: 'L1 이메일 우선',
      resolved: false,
    },
    {
      id: 'ms-C',
      multiSourceType: 'C',
      certainty: 1,
      department: '재무팀',
      topicTitle: '해외 출장 식비 한도',
      description: '공식 채널끼리 상충하여 AI 자동 해결이 불가합니다.',
      sources: [
        { channel: '재무 공지', channelType: 'email', author: '재무팀', time: '08:30', content: '1일 70달러', authorityLevel: 'L1' },
        { channel: '#출장문의', channelType: 'slack', author: '영업지원', time: '08:32', content: '1일 90달러', authorityLevel: 'L2' },
      ],
      resolvedContent: null,
      targets: [{ id: 'k13', title: '해외 출장 일비 기준', current: '미주·유럽 $80/일', category: '출장·정산' }],
      reason: '권위 있는 소스 간 충돌',
      resolved: false,
    },
    {
      id: 'ms-D',
      multiSourceType: 'D',
      certainty: 4,
      department: 'IT팀',
      topicTitle: '노트북 반납 체크리스트',
      description: '여러 문서 중 일부에만 적용할 수 있습니다.',
      sources: [
        { channel: '#it-asset', channelType: 'slack', author: '김도윤', time: '15:10', content: '퇴사 시 충전기와 보안키도 반납 대상입니다.', authorityLevel: 'L2' },
      ],
      resolvedContent: '퇴사 시 노트북, 충전기, 보안키를 함께 반납한다.',
      targets: [
        { id: 'k68', title: '퇴직 시 장비 반납', current: '노트북, 사원증, 충전기 등 지급 장비 일체', category: '장비·소프트웨어', selected: true },
        { id: 'k63', title: '퇴직 절차', current: '사내 계정·장비 반납', category: '채용·온보딩' },
      ],
      reason: '선택적 반영 가능',
      resolved: false,
    },
  ];
}

export function createSeedAiTagSuggestions(): AiTagSuggestion[] {
  return [
    { id: 'tag-1', itemId: 'k22', itemTitle: '택배 수령 절차', tag: '사무환경', reason: '내용 분석 결과 사무환경 관련 키워드 다수 감지', status: 'pending' },
    { id: 'tag-2', itemId: 'k35', itemTitle: '건강검진 안내', tag: '복리후생', reason: '복지 제도 관련 내용으로 복리후생 태그 제안', status: 'pending' },
    { id: 'tag-3', itemId: 'k81', itemTitle: '계정 잠금 해제 방법', tag: '보안·권한', reason: '계정 보안 관련 내용으로 보안·권한 태그 제안', status: 'pending' },
  ];
}

export function createSeedActivity(): ActivityEntry[] {
  return [
    { id: 'act-1', actor: 'ai', actorLabel: 'LORE', department: '총무팀', kind: 'detect', targetTitle: '법인카드 제출 기한 변경 감지', time: '방금 전' },
    { id: 'act-2', actor: 'conflict', actorLabel: '충돌', department: '인사팀', kind: 'detect', targetTitle: '건강검진 기준 충돌', time: '8분 전' },
    { id: 'act-3', actor: 'user', actorLabel: '이지수', department: '총무팀', kind: 'edit', targetTitle: '회의실 예약 문서 수정', time: '20분 전' },
    { id: 'act-4', actor: 'ai', actorLabel: 'LORE', department: 'IT팀', kind: 'create', targetTitle: 'VPN MFA 초기화 절차 생성', time: '1시간 전' },
    { id: 'act-5', actor: 'user', actorLabel: '박민지', department: '인사팀', kind: 'edit', targetTitle: '경조사 지원금 기준 확인', time: '2시간 전' },
  ];
}

export function createSeedDigest(pendingReview: number): DailyDigest {
  return {
    dateLabel: '2026년 5월 30일',
    updatedAtLabel: '방금 전',
    leadCounts: { detected: 23, conflicts: 2, toApply: pendingReview },
    topSearch: '법인카드 정산',
    sections: [
      { title: '충돌이 감지된 정책', pill: '직접 판단 필요', tone: 'warn', entities: [{ kind: 'conflict', itemId: 'k35', title: '건강검진 안내', quote: '입사 즉시 vs 기존 기준' }] },
      { title: '새로 감지된 조직 지식', pill: '+신규 4건', tone: 'ok', entities: [{ kind: 'new', itemId: 'k72', title: 'VPN 설치 및 접속' }] },
      { title: '기존 지식이 갱신됩니다', pill: '업데이트 7건', tone: 'info', entities: [{ kind: 'update', itemId: 'k07', title: '법인카드 정산 기한 및 방법' }] },
    ],
    metrics: {
      pendingReview,
      todayNewCount: 4,
      failedCount: 2,
      analysisCount: 347,
      extractedCount: 23,
      autoAppliedCount: 20,
      autoProcessingRate: 43,
    },
    mostAsked: [
      { key: 'corp-card', label: '법인카드', count: 43 },
      { key: 'health', label: '건강검진', count: 28, flag: '충돌' },
      { key: 'travel', label: '출장', count: 24 },
      { key: 'office', label: '회의실', count: 18 },
    ],
  };
}

export function groupKnowledgeByCategory(items: KnowledgeItem[], topics = createSeedTopics()): TreeCategory[] {
  return topics
    .map((topic) => ({ ...topic, items: items.filter((item) => item.category === topic.name) }))
    .filter((topic) => topic.items.length > 0 || topic.name === '미분류');
}
