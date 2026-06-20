import {
  RISK_FACTOR_LABEL,
  canAutoPublish,
  riskFactors,
  type CandidateRoute,
  type KnowledgeCandidate,
  type RiskFactor,
} from '@wf/shared';
import { defaultPolicy, type Policy } from './policy.js';

const RISK_TO_WKF_TYPE: Partial<Record<RiskFactor, string>> = {
  policy: 'POLICY',
  regulation: 'REGULATION',
  pricing: 'METRIC',
};

const REVIEW_REASON_ORDER = new Map<RiskFactor, number>(riskFactors.map((factor, index) => [factor, index]));

function orderedReasons(candidate: Pick<KnowledgeCandidate, 'riskFactors' | 'status' | 'provenance' | 'conflictWith'>): RiskFactor[] {
  const reasons = new Set<RiskFactor>(candidate.riskFactors);
  if (candidate.status === 'CONFLICTED' || candidate.conflictWith.length > 0) reasons.add('conflict');
  if (candidate.provenance.needsSource) reasons.add('no_source');
  return [...reasons].sort((a, b) => (REVIEW_REASON_ORDER.get(a) ?? 99) - (REVIEW_REASON_ORDER.get(b) ?? 99));
}

function approverRolesFor(candidate: KnowledgeCandidate, policy: Policy): string[] {
  let overrideRoles: Set<string> | undefined;
  const fallbackRoles = new Set<string>();
  for (const factor of orderedReasons(candidate)) {
    const type = RISK_TO_WKF_TYPE[factor];
    if (type && policy.review.overrides[type]) {
      const next = new Set(policy.review.overrides[type]);
      overrideRoles =
        overrideRoles == null ? next : new Set([...overrideRoles].filter((role) => next.has(role)));
      continue;
    }
    for (const role of policy.review.approver_roles) fallbackRoles.add(role);
  }
  if (overrideRoles && overrideRoles.size > 0) return [...overrideRoles];
  if (fallbackRoles.size > 0) return [...fallbackRoles];
  for (const role of policy.review.approver_roles) fallbackRoles.add(role);
  return [...fallbackRoles];
}

function roleMatches(role: string | undefined, allowed: string[]): boolean {
  if (!role) return false;
  const normalized = role.toUpperCase();
  return allowed.some((candidate) => candidate.toUpperCase() === normalized);
}

export function routeCandidate(
  candidate: KnowledgeCandidate,
  policy: Policy = defaultPolicy,
  context: { role?: string } = {},
): CandidateRoute {
  const reasons = orderedReasons(candidate);
  const approverRoles = approverRolesFor(candidate, policy);
  const canApprove = roleMatches(context.role, approverRoles);
  const base = {
    reasons,
    reasonLabels: reasons.map((reason) => RISK_FACTOR_LABEL[reason]),
    approverRoles,
    canApprove,
  };

  if (candidate.status === 'CONFLICTED' || reasons.includes('conflict')) {
    return {
      ...base,
      action: 'reject',
      recommendedAction: '충돌 후보는 공식 게시하지 말고 기존 지식과 별도 확인합니다.',
    };
  }

  if (canAutoPublish(candidate)) {
    return {
      ...base,
      action: 'auto_publish',
      recommendedAction: '위험 요인이 없는 출처 기반 후보이므로 자동 게시할 수 있습니다.',
    };
  }

  if (candidate.status === 'NEEDS_CHECK' || reasons.includes('no_source')) {
    return {
      ...base,
      action: 'needs_source',
      recommendedAction: '출처 문서를 연결하거나 담당자 확인을 요청합니다.',
    };
  }

  return {
    ...base,
    action: 'needs_approval',
    recommendedAction: '승인 권한자가 사유를 확인한 뒤 공식 지식으로 승격합니다.',
  };
}
