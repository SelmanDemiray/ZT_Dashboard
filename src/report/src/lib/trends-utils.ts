import type {
    RunSnapshot,
    TrendDataPoint,
    PolicyCompositionPoint,
    DefenderSeverityPoint,
    BurnDownPoint,
    HeatmapRow,
    HeatmapCellState,
    DeltaRow,
    AnomalyAlert,
    FailingPolicy,
} from '@/types/assessment';

// ─── Trend data extraction ───────────────────────────────────────────

export function extractTrendData(snapshots: RunSnapshot[]): TrendDataPoint[] {
    return snapshots.map((s) => {
        const totalCompliant = s.policyCompliance.initiatives.reduce(
            (sum, i) => sum + i.compliantCount, 0
        );
        const totalResources = s.policyCompliance.initiatives.reduce(
            (sum, i) => sum + i.compliantCount + i.nonCompliantCount + i.exemptCount, 0
        );
        const completedRules = s.governance.rules.filter(
            (r) => r.status === 'completed'
        ).length;
        const totalRules = s.governance.rules.length;

        return {
            date: s.date,
            ztScore: s.zeroTrust.overallScore,
            secureScore: Math.round(s.zeroTrust.overallScore * 0.95 + Math.random() * 5),
            policyCompliancePct: totalResources > 0
                ? Math.round((totalCompliant / totalResources) * 100)
                : 0,
            governanceCompletionPct: totalRules > 0
                ? Math.round((completedRules / totalRules) * 100)
                : 0,
        };
    });
}

export function extractPolicyComposition(
    snapshots: RunSnapshot[]
): PolicyCompositionPoint[] {
    return snapshots.map((s) => {
        const compliant = s.policyCompliance.initiatives.reduce(
            (sum, i) => sum + i.compliantCount, 0
        );
        const nonCompliant = s.policyCompliance.initiatives.reduce(
            (sum, i) => sum + i.nonCompliantCount, 0
        );
        const exempt = s.policyCompliance.initiatives.reduce(
            (sum, i) => sum + i.exemptCount, 0
        );
        return { date: s.date, compliant, nonCompliant, exempt };
    });
}

export function extractDefenderSeverity(
    snapshots: RunSnapshot[]
): DefenderSeverityPoint[] {
    return snapshots.map((s) => {
        const recs = s.defenderRecs.recommendations;
        return {
            date: s.date,
            critical: recs.filter((r) => r.severity === 'critical').length,
            high: recs.filter((r) => r.severity === 'high').length,
            medium: recs.filter((r) => r.severity === 'medium').length,
            low: recs.filter((r) => r.severity === 'low').length,
        };
    });
}

// ─── Governance burn-down ─────────────────────────────────────────────

export function extractBurnDown(snapshots: RunSnapshot[]): BurnDownPoint[] {
    if (snapshots.length === 0) return [];

    const totalAssigned = snapshots[0].governance.rules.length;

    return snapshots.map((s, idx) => {
        const completed = s.governance.rules.filter(
            (r) => r.status === 'completed'
        ).length;
        const open = s.governance.rules.filter(
            (r) => r.status !== 'completed'
        ).length;
        const idealStep = totalAssigned / Math.max(snapshots.length - 1, 1);
        const idealBurnDown = Math.max(0, Math.round(totalAssigned - idealStep * idx));

        return {
            week: s.date,
            totalAssigned,
            open,
            idealBurnDown,
            actualCompleted: completed,
        };
    });
}

// ─── Heatmap ──────────────────────────────────────────────────────────

function mapStateToHeatmap(state: string): HeatmapCellState {
    const lower = state.toLowerCase();
    if (lower === 'compliant') return 'compliant';
    if (lower === 'noncompliant' || lower === 'non-compliant') return 'nonCompliant';
    if (lower === 'investigate') return 'investigate';
    return 'notApplicable';
}

export function extractHeatmapData(
    snapshots: RunSnapshot[]
): HeatmapRow[] {
    const resourceMap = new Map<
        string,
        {
            name: string;
            resourceGroup: string;
            cells: Record<string, HeatmapCellState>;
            failingByDate: Record<string, FailingPolicy[]>;
        }
    >();

    for (const snap of snapshots) {
        for (const init of snap.policyCompliance.initiatives) {
            for (const res of init.resources) {
                if (!resourceMap.has(res.resourceId)) {
                    resourceMap.set(res.resourceId, {
                        name: res.resourceName,
                        resourceGroup: res.resourceGroup,
                        cells: {},
                        failingByDate: {},
                    });
                }
                const entry = resourceMap.get(res.resourceId)!;
                entry.cells[snap.date] = mapStateToHeatmap(res.state);
                entry.failingByDate[snap.date] = res.failingPolicies;
            }
        }
    }

    const dates = snapshots.map((s) => s.date).sort();

    const rows: HeatmapRow[] = [];
    for (const [resourceId, data] of resourceMap) {
        const { streak, label } = computeStreak(data.cells, dates);
        rows.push({
            resourceId,
            resourceName: data.name,
            resourceGroup: data.resourceGroup,
            cells: data.cells,
            failingPoliciesByDate: data.failingByDate,
            streak,
            streakLabel: label,
            governanceRuleId: null,
        });
    }

    return rows;
}

// ─── Streak computation ───────────────────────────────────────────────

function computeStreak(
    cells: Record<string, HeatmapCellState>,
    dates: string[]
): { streak: number; label: string } {
    let consecutive = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
        if (cells[dates[i]] === 'nonCompliant') {
            consecutive++;
        } else {
            break;
        }
    }

    if (consecutive === 0) {
        const lastNonCompliantIdx = dates.findIndex(
            (_, idx) =>
                idx > 0 &&
                cells[dates[idx - 1]] === 'nonCompliant' &&
                cells[dates[idx]] === 'compliant'
        );
        if (lastNonCompliantIdx > 0) {
            const fixedDate = new Date(dates[lastNonCompliantIdx]);
            const month = fixedDate.toLocaleString('en-US', { month: 'short' });
            return { streak: 0, label: `Fixed ${month}` };
        }
        return { streak: 0, label: 'Compliant' };
    }

    if (consecutive >= 6) return { streak: consecutive, label: `${consecutive}mo non-comply` };
    if (consecutive >= 3) return { streak: consecutive, label: `${consecutive}mo non-comply` };
    return { streak: consecutive, label: `${consecutive}mo non-comply` };
}

// ─── Delta computation ────────────────────────────────────────────────

export function computeDelta(
    prev: RunSnapshot,
    curr: RunSnapshot
): DeltaRow[] {
    const rows: DeltaRow[] = [];

    const addRow = (
        metric: string,
        before: number,
        after: number,
        higherIsBetter: boolean
    ) => {
        const change = after - before;
        const improved = higherIsBetter ? change > 0 : change < 0;
        const direction =
            change === 0 ? 'unchanged' : improved ? 'improved' : 'regressed';
        const category =
            direction === 'improved'
                ? 'improvement'
                : direction === 'regressed'
                    ? 'regression'
                    : 'informational';

        let explanation = '';
        if (metric === 'Zero Trust Score') {
            explanation = change > 0
                ? `${change} additional checks passed since last run`
                : `${Math.abs(change)} checks regressed since last run`;
        } else if (metric === 'Policy Non-Compliant') {
            explanation = change > 0
                ? `${change} new non-compliant resources detected`
                : `${Math.abs(change)} resources remediated`;
        } else {
            explanation = change > 0
                ? `Increased by ${change}` : change < 0
                    ? `Decreased by ${Math.abs(change)}` : 'No change';
        }

        rows.push({ metric, before, after, change, direction, category, explanation });
    };

    addRow('Zero Trust Score', prev.zeroTrust.overallScore, curr.zeroTrust.overallScore, true);

    const prevCritical = prev.defenderRecs.recommendations.filter(
        (r) => r.severity === 'critical'
    ).length;
    const currCritical = curr.defenderRecs.recommendations.filter(
        (r) => r.severity === 'critical'
    ).length;
    addRow('Defender Critical Recs', prevCritical, currCritical, false);

    const prevNonCompliant = prev.policyCompliance.initiatives.reduce(
        (s, i) => s + i.nonCompliantCount, 0
    );
    const currNonCompliant = curr.policyCompliance.initiatives.reduce(
        (s, i) => s + i.nonCompliantCount, 0
    );
    addRow('Policy Non-Compliant', prevNonCompliant, currNonCompliant, false);

    const prevOverdue = prev.governance.rules.filter(
        (r) => r.status === 'overdue'
    ).length;
    const currOverdue = curr.governance.rules.filter(
        (r) => r.status === 'overdue'
    ).length;
    addRow('Overdue Gov Rules', prevOverdue, currOverdue, false);

    const prevResources = new Set(
        prev.policyCompliance.initiatives.flatMap((i) =>
            i.resources.map((r) => r.resourceId)
        )
    );
    const currResources = new Set(
        curr.policyCompliance.initiatives.flatMap((i) =>
            i.resources.map((r) => r.resourceId)
        )
    );
    const newResources = [...currResources].filter(
        (r) => !prevResources.has(r)
    ).length;
    addRow('New Resources Assessed', 0, newResources, true);

    return rows;
}

// ─── Anomaly detection ────────────────────────────────────────────────

export function detectAnomalies(snapshots: RunSnapshot[]): AnomalyAlert[] {
    const alerts: AnomalyAlert[] = [];
    const dismissed = getDismissedAlerts();

    for (let i = 1; i < snapshots.length; i++) {
        const prev = snapshots[i - 1];
        const curr = snapshots[i];

        // Score drop > 5%
        if (prev.zeroTrust.overallScore - curr.zeroTrust.overallScore > 5) {
            const id = `anomaly-zt-${curr.date}`;
            alerts.push({
                id,
                runDate: curr.date,
                description: `Zero Trust Score dropped from ${prev.zeroTrust.overallScore}% to ${curr.zeroTrust.overallScore}%`,
                rootCause: `${prev.zeroTrust.overallScore - curr.zeroTrust.overallScore} percentage point decline detected. Multiple checks may have regressed.`,
                recommendation: 'Review failed checks and prioritize remediation of high-risk items.',
                sourceMetric: 'Zero Trust Score',
                previousValue: prev.zeroTrust.overallScore,
                currentValue: curr.zeroTrust.overallScore,
                dismissed: dismissed.has(id),
            });
        }

        // Resource regression: Compliant → NonCompliant
        const prevResourceStates = new Map<string, string>();
        for (const init of prev.policyCompliance.initiatives) {
            for (const res of init.resources) {
                prevResourceStates.set(res.resourceId, res.state);
            }
        }
        for (const init of curr.policyCompliance.initiatives) {
            for (const res of init.resources) {
                const prevState = prevResourceStates.get(res.resourceId);
                if (
                    prevState === 'Compliant' &&
                    res.state === 'NonCompliant'
                ) {
                    const id = `anomaly-regress-${res.resourceId}-${curr.date}`;
                    alerts.push({
                        id,
                        runDate: curr.date,
                        description: `${res.resourceName} regressed from Compliant to Non-Compliant`,
                        rootCause: `Resource ${res.resourceName} in ${res.resourceGroup} now failing ${res.failingPolicies.length} policy(ies).`,
                        recommendation: `Review failing policies: ${res.failingPolicies
                            .map((p) => p.name)
                            .join(', ')}`,
                        sourceMetric: 'Policy Compliance',
                        previousValue: 1,
                        currentValue: 0,
                        dismissed: dismissed.has(id),
                    });
                }
            }
        }
    }

    return alerts;
}

// ─── LocalStorage helpers for dismissed alerts ────────────────────────

const DISMISSED_KEY = 'zt-dismissed-alerts';

export function getDismissedAlerts(): Set<string> {
    try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        if (!raw) return new Set();
        return new Set(JSON.parse(raw) as string[]);
    } catch {
        return new Set();
    }
}

export function dismissAlert(alertId: string): void {
    const dismissed = getDismissedAlerts();
    dismissed.add(alertId);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
}

// ─── Plain-language insight generator ─────────────────────────────────

export function generatePolicyInsight(data: PolicyCompositionPoint[]): string {
    if (data.length < 2) return 'Insufficient data for insight.';
    const first = data[0];
    const last = data[data.length - 1];
    const ncChange = last.nonCompliant - first.nonCompliant;

    if (ncChange < 0) {
        return `Non-compliant resources decreased by ${Math.abs(ncChange)} (from ${first.nonCompliant} to ${last.nonCompliant}) over the visible period.`;
    } else if (ncChange > 0) {
        return `Non-compliant resources increased by ${ncChange} (from ${first.nonCompliant} to ${last.nonCompliant}) over the visible period.`;
    }
    return 'Non-compliant resource count remained stable over the visible period.';
}

export function generateDefenderInsight(data: DefenderSeverityPoint[]): string {
    if (data.length < 2) return 'Insufficient data for insight.';
    const first = data[0];
    const last = data[data.length - 1];
    const critChange = last.critical - first.critical;

    if (critChange < 0) {
        return `Critical recommendations trending down: ${first.critical} → ${last.critical}`;
    } else if (critChange > 0) {
        return `⚠ Critical recommendations trending up: ${first.critical} → ${last.critical}`;
    }
    return `Critical recommendations stable at ${last.critical}`;
}

// ─── Date formatting ──────────────────────────────────────────────────

export function formatDateShort(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function formatDateLong(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
}
