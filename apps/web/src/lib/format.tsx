import type { KnowledgeFreshness, SourceAuthority } from '@wf/shared';

export const CAT_COLORS: Record<string, string> = {
  '법인카드': '#dd5b00',
  '출장·정산': '#0075de',
  '사무환경': '#2a9d99',
  '복리후생': '#7b3ff2',
  '근태·휴가': '#e03131',
  '급여·정산': '#dd5b00',
  '채용·온보딩': '#1aae39',
  '장비·소프트웨어': '#0075de',
  '사내시스템': '#7b3ff2',
  '보안·권한': '#5645d4',
  '미분류': '#999999',
};

const AV_COLORS = ['#5645d4', '#0ea5e9', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6'];

export function catTint(category: string): string {
  return CAT_COLORS[category] ?? '#64748b';
}

export function avColor(name: string): string {
  const code = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AV_COLORS[code % AV_COLORS.length]!;
}

export function dots(n: number): string {
  return '●'.repeat(n) + '○'.repeat(Math.max(0, 5 - n));
}

export function dotColor(n: number): string {
  if (n >= 4) return 'var(--green)';
  if (n >= 3) return 'var(--orange)';
  return 'var(--red)';
}

export function freshnessLabel(value: KnowledgeFreshness): string {
  return value === 'latest' ? '최신' : value === 'needs_update' ? '업데이트 필요' : '충돌';
}

export function srcLevel(channel: string): SourceAuthority {
  if (channel.includes('공지') || channel.includes('Email') || channel.includes('email')) return 'L1';
  if (channel.includes('Notion')) return 'L2';
  if (channel.includes('Slack') || channel.includes('#')) return 'L3';
  return 'L4';
}
