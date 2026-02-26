// ─── Zero Trust Assessment ────────────────────────────────────────────
export interface ZeroTrustPillar {
  name: string;
  score: number;
  totalChecks: number;
  passed: number;
  failed: number;
}

export type CheckStatus = 'passed' | 'failed' | 'investigate' | 'notApplicable';
export type RiskLevel = 'high' | 'medium' | 'low' | 'informational';

export interface ZeroTrustCheck {
  id: string;
  name: string;
  pillar: string;
  area: string;
  status: CheckStatus;
  risk: RiskLevel;
  description: string;
  remediation: string;
  learnMoreUrl: string;
  score: number;
  weight: number;
}

export interface ZeroTrust {
  tenantId: string;
  tenantName: string;
  runDate: string;
  overallScore: number;
  pillars: ZeroTrustPillar[];
  checks: ZeroTrustCheck[];
}

// ─── Policy Compliance ────────────────────────────────────────────────
export interface FailingPolicy {
  id: string;
  name: string;
  description: string;
}

export interface PolicyResource {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  state: string;
  failingPolicies: FailingPolicy[];
}

export interface PolicyInitiative {
  id: string;
  name: string;
  type: 'builtin' | 'custom';
  assignmentId: string;
  subscriptionId: string;
  compliantCount: number;
  nonCompliantCount: number;
  exemptCount: number;
  totalPolicies: number;
  resources: PolicyResource[];
}

export interface PolicyCompliance {
  runDate: string;
  initiatives: PolicyInitiative[];
}

// ─── Defender Recommendations ─────────────────────────────────────────
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface AffectedResource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
}

export interface DefenderRecommendation {
  id: string;
  name: string;
  description: string;
  severity: Severity;
  category: string;
  subscriptionId: string;
  resourceCount: number;
  hasAttackPath: boolean;
  affectedResources: AffectedResource[];
  remediation: string;
  learnMoreUrl: string;
  governanceAssignmentId: string;
}

export interface DefenderRecs {
  runDate: string;
  recommendations: DefenderRecommendation[];
}

// ─── Governance ───────────────────────────────────────────────────────
export type GovernanceStatus = 'notStarted' | 'inProgress' | 'completed' | 'overdue';

export interface CompletionCriterion {
  description: string;
  completed: boolean;
}

export interface GovernanceRule {
  id: string;
  name: string;
  owner: string;
  ownerEmail: string;
  dueDate: string;
  subscriptionId: string;
  status: GovernanceStatus;
  completionPercentage: number;
  linkedRecommendationIds: string[];
  linkedPolicyIds: string[];
  description: string;
  completionCriteria: CompletionCriterion[];
}

export interface Governance {
  runDate: string;
  rules: GovernanceRule[];
}

// ─── Tenant Index ─────────────────────────────────────────────────────
export interface TenantSubscription {
  id: string;
  name: string;
  resourceGroups: string[];
  dates: string[];
}

export interface TenantEntry {
  id: string;
  name: string;
  subscriptions: TenantSubscription[];
}

export interface TenantIndex {
  tenants: TenantEntry[];
}

// ─── Global Filter State ─────────────────────────────────────────────
export interface GlobalFilterState {
  tenantId: string;
  subscriptionId: string;
  resourceGroupId: string;
  resourceType: string;
  severity: string;
  status: string;
  dateRange: [Date, Date];
  granularity: 'weekly' | 'monthly';
}

// ─── Trend-Specific Types ─────────────────────────────────────────────
export interface TrendDataPoint {
  date: string;
  ztScore: number;
  secureScore: number;
  policyCompliancePct: number;
  governanceCompletionPct: number;
}

export interface PolicyCompositionPoint {
  date: string;
  compliant: number;
  nonCompliant: number;
  exempt: number;
}

export interface DefenderSeverityPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface BurnDownPoint {
  week: string;
  totalAssigned: number;
  open: number;
  idealBurnDown: number;
  actualCompleted: number;
}

export type HeatmapCellState = 'compliant' | 'nonCompliant' | 'investigate' | 'notApplicable';

export interface HeatmapCell {
  resourceId: string;
  resourceName: string;
  date: string;
  state: HeatmapCellState;
  failingPolicies: FailingPolicy[];
}

export interface HeatmapRow {
  resourceId: string;
  resourceName: string;
  resourceGroup: string;
  cells: Record<string, HeatmapCellState>;
  failingPoliciesByDate: Record<string, FailingPolicy[]>;
  streak: number;
  streakLabel: string;
  governanceRuleId: string | null;
}

export interface DeltaRow {
  metric: string;
  before: number;
  after: number;
  change: number;
  direction: 'improved' | 'regressed' | 'unchanged';
  category: 'improvement' | 'regression' | 'informational';
  explanation: string;
}

export interface AnomalyAlert {
  id: string;
  runDate: string;
  description: string;
  rootCause: string;
  recommendation: string;
  sourceMetric: string;
  previousValue: number;
  currentValue: number;
  dismissed: boolean;
}

// ─── Trends Filter State (tab-local) ─────────────────────────────────
export interface TrendsFilterState {
  subscriptionId: string;
  resourceGroupId: string;
  dataSource: 'all' | 'zeroTrust' | 'policy' | 'defender' | 'governance';
  dateRange: [Date, Date];
  granularity: 'weekly' | 'monthly';
  compareSubscriptionId: string;
}

// ─── Snapshot bundle for a single run ─────────────────────────────────
export interface RunSnapshot {
  date: string;
  zeroTrust: ZeroTrust;
  policyCompliance: PolicyCompliance;
  defenderRecs: DefenderRecs;
  governance: Governance;
}
