import {
  CANDIDATE_STATUS_LABEL,
  RISK_FACTOR_LABEL,
  type CandidateStatus,
  type RiskFactor,
} from '@wf/shared';
import { Badge } from './Primitives.js';

const STATUS_TONE: Record<CandidateStatus, 'neutral' | 'ok' | 'warn' | 'error' | 'info'> = {
  AI_ORGANIZED: 'info',
  SOURCE_VERIFIED: 'ok',
  NEEDS_CHECK: 'warn',
  NEEDS_APPROVAL: 'warn',
  PUBLISHED: 'ok',
  CONFLICTED: 'error',
};

export function TrustLabel({
  status,
  riskFactors = [],
}: {
  status: CandidateStatus;
  riskFactors?: RiskFactor[];
}) {
  return (
    <span className="trust-label">
      <Badge tone={STATUS_TONE[status]}>{CANDIDATE_STATUS_LABEL[status]}</Badge>
      {riskFactors.slice(0, 2).map((riskFactor) => (
        <Badge tone="warn" key={riskFactor}>{RISK_FACTOR_LABEL[riskFactor]}</Badge>
      ))}
      {riskFactors.length > 2 ? <Badge tone="warn">+{riskFactors.length - 2}</Badge> : null}
    </span>
  );
}
