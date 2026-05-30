import type { KnowledgeFreshness, ReviewPriority, SourceAuthority } from '@wf/shared';

export const CAT_COLORS: Record<string, string> = {
  법인카드: '#5645d4',
  출장: '#0ea5e9',
  복리후생: '#16a34a',
  사무환경: '#f59e0b',
  보안: '#ef4444',
  입퇴사: '#8b5cf6',
  건강검진: '#14b8a6',
  미분류: '#94a3b8',
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

export function priorityLabel(value: ReviewPriority): string {
  return value.toUpperCase();
}

export function srcLevel(channel: string): SourceAuthority {
  if (channel.includes('공지') || channel.includes('Email') || channel.includes('email')) return 'L1';
  if (channel.includes('Notion')) return 'L2';
  if (channel.includes('Slack') || channel.includes('#')) return 'L3';
  return 'L4';
}

export function bodyBlocks(markdown: string) {
  return markdown.split(/\r?\n/).filter((line) => line.trim().length > 0);
}
