import type {
    DefenderRecommendation,
    DefenderRecs,
    FailingPolicy,
    Governance,
    GovernanceRule,
    PolicyCompliance,
    PolicyInitiative,
    PolicyResource,
    RunSnapshot,
    TenantSubscription,
    ZeroTrust,
    ZeroTrustCheck,
    ZeroTrustPillar,
} from '@/types/assessment';

type RiskStatus = ZeroTrustCheck['status'];
type GovernanceStatus = GovernanceRule['status'];
type DefenderSeverity = DefenderRecommendation['severity'];

const ZERO_TRUST_CHECK_STATUS_WORST_ORDER: RiskStatus[] = [
    'failed',
    'investigate',
    'passed',
    'notApplicable',
];

const GOVERNANCE_STATUS_WORST_ORDER: GovernanceStatus[] = [
    'overdue',
    'inProgress',
    'notStarted',
    'completed',
];

const DEFENDER_SEVERITY_WORST_ORDER: DefenderSeverity[] = [
    'critical',
    'high',
    'medium',
    'low',
];

function worstByOrder<T extends string>(values: T[], order: T[]): T | undefined {
    if (values.length === 0) return undefined;
    for (const v of order) {
        if (values.includes(v)) return v;
    }
    return values[0];
}

function maxRunDate(values: { runDate?: string }[]): string {
    const best = values
        .map((v) => v.runDate)
        .filter((d): d is string => Boolean(d))
        .map((d) => ({ d, t: new Date(d).getTime() }))
        .sort((a, b) => b.t - a.t)[0];
    return best?.d ?? '';
}

function aggregateZeroTrust(zts: ZeroTrust[]): ZeroTrust {
    if (zts.length === 0) {
        // Caller should handle empty case, but keep output safe.
        return {
            tenantId: '',
            tenantName: '',
            runDate: '',
            overallScore: 0,
            pillars: [],
            checks: [],
        };
    }

    const tenantId = zts.find((z) => z.tenantId)?.tenantId ?? zts[0].tenantId;
    const tenantName = zts.find((z) => z.tenantName)?.tenantName ?? zts[0].tenantName;

    const totalPillarChecksByName = new Map<
        string,
        { totalChecks: number; passed: number; failed: number; scoreSum: number; scoreCount: number }
    >();
    for (const zt of zts) {
        for (const p of zt.pillars ?? []) {
            const prev =
                totalPillarChecksByName.get(p.name) ?? {
                    totalChecks: 0,
                    passed: 0,
                    failed: 0,
                    scoreSum: 0,
                    scoreCount: 0,
                };
            prev.totalChecks += p.totalChecks ?? 0;
            prev.passed += p.passed ?? 0;
            prev.failed += p.failed ?? 0;
            prev.scoreSum += p.score ?? 0;
            prev.scoreCount += 1;
            totalPillarChecksByName.set(p.name, prev);
        }
    }

    const pillars: ZeroTrustPillar[] = Array.from(totalPillarChecksByName.entries()).map(([name, agg]) => {
        const denom = (agg.passed ?? 0) + (agg.failed ?? 0);
        const score =
            agg.totalChecks > 0 && denom > 0
                ? Math.round(((agg.passed ?? 0) / denom) * 100)
                : agg.scoreCount > 0
                  ? Math.round(agg.scoreSum / agg.scoreCount)
                  : 0;
        return {
            name,
            score,
            totalChecks: agg.totalChecks,
            passed: agg.passed,
            failed: agg.failed,
        };
    });

    // Merge checks by id, using the worst status.
    const checksById = new Map<string, ZeroTrustCheck & { _worstRank: number }>();
    for (const zt of zts) {
        for (const c of zt.checks ?? []) {
            const existing = checksById.get(c.id);
            const worstRank = ZERO_TRUST_CHECK_STATUS_WORST_ORDER.indexOf(c.status as RiskStatus);
            if (!existing) {
                checksById.set(c.id, { ...c, _worstRank: worstRank === -1 ? 9999 : worstRank });
                continue;
            }

            if (worstRank !== -1 && existing._worstRank !== -1 && worstRank < existing._worstRank) {
                // Replace metadata with the worst-status check; keep any existing fields if absent.
                checksById.set(c.id, { ...existing, ...c, _worstRank: worstRank });
                continue;
            }

            // If we can't rank, keep existing.
        }
    }

    const checks = Array.from(checksById.values()).map(({ _worstRank, ...c }) => c);

    const totalPassed = checks.filter((c) => c.status === 'passed').length;
    const totalFailed = checks.filter((c) => c.status === 'failed').length;
    const denom = totalPassed + totalFailed;
    const overallScore = denom > 0 ? Math.round((totalPassed / denom) * 100) : 0;

    return {
        tenantId,
        tenantName,
        runDate: maxRunDate(zts),
        overallScore,
        pillars,
        checks,
    };
}

function mergeUniqueFailingPolicies(resources: PolicyResource[]): FailingPolicy[] {
    // Failing policies are associated to a resource; dedupe by policy id.
    const all: FailingPolicy[] = [];
    const seen = new Set<string>();
    for (const r of resources) {
        for (const fp of r.failingPolicies ?? []) {
            if (seen.has(fp.id)) continue;
            seen.add(fp.id);
            all.push(fp);
        }
    }
    return all;
}

function aggregatePolicyCompliance(pcs: PolicyCompliance[]): PolicyCompliance {
    if (pcs.length === 0) {
        return { runDate: '', initiatives: [] };
    }

    const runDate = maxRunDate(pcs as any);

    const initiativesById = new Map<
        string,
        PolicyInitiative & { _resourcesById: Map<string, PolicyResource> }
    >();

    for (const pc of pcs) {
        for (const init of pc.initiatives ?? []) {
            const existing = initiativesById.get(init.id);
            if (!existing) {
                const resourcesById = new Map<string, PolicyResource>();
                for (const r of init.resources ?? []) resourcesById.set(r.resourceId, r);

                initiativesById.set(init.id, {
                    ...init,
                    resources: [],
                    _resourcesById: resourcesById,
                });
                continue;
            }

            existing.compliantCount += init.compliantCount ?? 0;
            existing.nonCompliantCount += init.nonCompliantCount ?? 0;
            existing.exemptCount += init.exemptCount ?? 0;
            existing.totalPolicies += init.totalPolicies ?? 0;

            for (const r of init.resources ?? []) {
                const prevRes = existing._resourcesById.get(r.resourceId);
                if (!prevRes) {
                    existing._resourcesById.set(r.resourceId, r);
                    continue;
                }

                // Pick the "worst" state: any non-Compliant makes the resource non-compliant.
                const state = prevRes.state !== 'Compliant' ? prevRes.state : r.state;
                const failingPolicies = mergeUniqueFailingPolicies([prevRes, r]);
                existing._resourcesById.set(r.resourceId, {
                    ...prevRes,
                    ...r,
                    state,
                    failingPolicies,
                });
            }
        }
    }

    const initiatives = Array.from(initiativesById.values()).map((init) => ({
        id: init.id,
        name: init.name,
        type: init.type,
        assignmentId: init.assignmentId,
        subscriptionId: init.subscriptionId,
        compliantCount: init.compliantCount,
        nonCompliantCount: init.nonCompliantCount,
        exemptCount: init.exemptCount,
        totalPolicies: init.totalPolicies,
        resources: Array.from(init._resourcesById.values()),
    }));

    // Sort for stable UI.
    initiatives.sort((a, b) => a.name.localeCompare(b.name));
    return { runDate, initiatives };
}

function aggregateGovernance(govs: Governance[]): Governance {
    if (govs.length === 0) return { runDate: '', rules: [] };
    const runDate = maxRunDate(govs as any);

    const rulesById = new Map<
        string,
        GovernanceRule & { _completionSum: number; _completionCount: number }
    >();

    for (const gov of govs) {
        for (const r of gov.rules ?? []) {
            const existing = rulesById.get(r.id);
            if (!existing) {
                rulesById.set(r.id, { ...r, _completionSum: r.completionPercentage ?? 0, _completionCount: 1 });
                continue;
            }

            // "Worst" status takes precedence.
            const status = worstByOrder<GovernanceRule['status']>(
                [existing.status, r.status],
                GOVERNANCE_STATUS_WORST_ORDER
            ) ?? existing.status;

            existing.status = status;
            existing._completionSum += r.completionPercentage ?? 0;
            existing._completionCount += 1;

            // Earliest due date keeps overdue visible.
            const existingDue = existing.dueDate ? new Date(existing.dueDate).getTime() : null;
            const nextDue = r.dueDate ? new Date(r.dueDate).getTime() : null;
            if (existingDue !== null && nextDue !== null) {
                if (nextDue < existingDue) existing.dueDate = r.dueDate;
            }

            existing.linkedRecommendationIds = Array.from(
                new Set([...(existing.linkedRecommendationIds ?? []), ...(r.linkedRecommendationIds ?? [])])
            );
            existing.linkedPolicyIds = Array.from(
                new Set([...(existing.linkedPolicyIds ?? []), ...(r.linkedPolicyIds ?? [])])
            );

            // Merge completion criteria by description.
            const byDesc = new Map<string, { description: string; completed: boolean }>();
            for (const c of existing.completionCriteria ?? []) {
                byDesc.set(c.description, { ...c });
            }
            for (const c of r.completionCriteria ?? []) {
                const prev = byDesc.get(c.description);
                if (!prev) {
                    byDesc.set(c.description, { ...c });
                } else {
                    prev.completed = prev.completed || c.completed;
                }
            }
            existing.completionCriteria = Array.from(byDesc.values());

            // Prefer richer metadata if it exists.
            existing.owner = existing.owner || r.owner;
            existing.ownerEmail = existing.ownerEmail || r.ownerEmail;
            existing.name = existing.name || r.name;
            existing.description = existing.description || r.description;
        }
    }

    const rules: GovernanceRule[] = Array.from(rulesById.values()).map((r) => ({
        ...r,
        completionPercentage:
            r._completionCount > 0 ? Math.round(r._completionSum / r._completionCount) : r.completionPercentage,
    }));

    // Stable order.
    rules.sort((a, b) => a.name.localeCompare(b.name));
    return { runDate, rules };
}

function aggregateDefenderRecs(defs: DefenderRecs[]): DefenderRecs {
    if (defs.length === 0) return { runDate: '', recommendations: [] };
    const runDate = maxRunDate(defs as any);

    const recsById = new Map<
        string,
        DefenderRecommendation & { _severityRank: number; _resourceCountSum: number }
    >();

    for (const d of defs) {
        for (const rec of d.recommendations ?? []) {
            const existing = recsById.get(rec.id);
            const severityRank = DEFENDER_SEVERITY_WORST_ORDER.indexOf(rec.severity as DefenderSeverity);
            const safeRank = severityRank === -1 ? 9999 : severityRank;

            if (!existing) {
                recsById.set(rec.id, {
                    ...rec,
                    _severityRank: safeRank,
                    _resourceCountSum: rec.resourceCount ?? 0,
                });
                continue;
            }

            // Worst severity.
            const severity = worstByOrder<DefenderSeverity>(
                [existing.severity, rec.severity],
                DEFENDER_SEVERITY_WORST_ORDER
            ) ?? existing.severity;
            existing.severity = severity;

            // Sum resource counts; keep worst attack-path flag.
            existing._resourceCountSum += rec.resourceCount ?? 0;
            existing.hasAttackPath = existing.hasAttackPath || rec.hasAttackPath;

            existing.affectedResources = (() => {
                const byId = new Map<string, DefenderRecommendation['affectedResources'][number]>();
                for (const ar of existing.affectedResources ?? []) byId.set(ar.id, ar);
                for (const ar of rec.affectedResources ?? []) byId.set(ar.id, ar);
                return Array.from(byId.values());
            })();

            existing.category = existing.category || rec.category;
            existing.remediation = existing.remediation || rec.remediation;
            existing.learnMoreUrl = existing.learnMoreUrl || rec.learnMoreUrl;
        }
    }

    const recommendations = Array.from(recsById.values()).map((r) => ({
        ...r,
        resourceCount: r._resourceCountSum,
    }));

    // Stable order.
    recommendations.sort((a, b) => a.name.localeCompare(b.name));
    return { runDate, recommendations };
}

function aggregateRunSnapshot(group: RunSnapshot[], date: string): RunSnapshot {
    const zeroTrust = aggregateZeroTrust(group.map((s) => s.zeroTrust).filter(Boolean));
    const policyCompliance = aggregatePolicyCompliance(group.map((s) => s.policyCompliance).filter(Boolean));
    const defenderRecs = aggregateDefenderRecs(group.map((s) => s.defenderRecs).filter(Boolean));
    const governance = aggregateGovernance(group.map((s) => s.governance).filter(Boolean));

    const storageAccounts = (() => {
        const runDate = maxRunDate(group.map((s) => s.storageAccounts));
        const accountsById = new Map<string, RunSnapshot['storageAccounts']['accounts'][number]>();
        for (const s of group) {
            for (const a of s.storageAccounts?.accounts ?? []) accountsById.set(a.id, a);
        }
        return { runDate, accounts: Array.from(accountsById.values()) };
    })();

    // Not needed for the overview section, but keep a correct shape.
    const finops = (() => {
        const first = group.find((s) => s.finops) ?? group[0];
        return {
            runDate: first?.finops?.runDate ?? '',
            serviceCosts: group.flatMap((s) => s.finops?.serviceCosts ?? []),
            subscriptionCosts: group.flatMap((s) => s.finops?.subscriptionCosts ?? []),
            teamCosts: group.flatMap((s) => s.finops?.teamCosts ?? []),
            dailyCostData: group.flatMap((s) => s.finops?.dailyCostData ?? []),
            weeklyCostData: group.flatMap((s) => s.finops?.weeklyCostData ?? []),
            monthlyCostData: group.flatMap((s) => s.finops?.monthlyCostData ?? []),
            costAnomalies: group.flatMap((s) => s.finops?.costAnomalies ?? []),
            savingsRecommendations: group.flatMap((s) => s.finops?.savingsRecommendations ?? []),
        };
    })();

    const vmsContainers = (() => {
        const first = group.find((s) => s.vmsContainers) ?? group[0];
        return {
            runDate: first?.vmsContainers?.runDate ?? '',
            virtualMachines: group.flatMap((s) => s.vmsContainers?.virtualMachines ?? []),
            aksClusters: group.flatMap((s) => s.vmsContainers?.aksClusters ?? []),
        };
    })();

    const networks = (() => {
        const first = group.find((s) => s.networks) ?? group[0];
        return {
            runDate: first?.networks?.runDate ?? '',
            vnets: group.flatMap((s) => s.networks?.vnets ?? []),
            nsgs: group.flatMap((s) => s.networks?.nsgs ?? []),
            firewalls: group.flatMap((s) => s.networks?.firewalls ?? []),
            loadBalancers: group.flatMap((s) => s.networks?.loadBalancers ?? []),
        };
    })();

    return {
        date,
        zeroTrust,
        policyCompliance,
        defenderRecs,
        governance,
        storageAccounts,
        finops,
        vmsContainers,
        networks,
    };
}

export function aggregateRunSnapshotsByDate(subSnapshots: RunSnapshot[][]): RunSnapshot[] {
    const groupMap = new Map<string, RunSnapshot[]>();
    for (const snaps of subSnapshots) {
        for (const s of snaps ?? []) {
            const list = groupMap.get(s.date) ?? [];
            list.push(s);
            groupMap.set(s.date, list);
        }
    }

    const dates = Array.from(groupMap.keys()).sort((a, b) => {
        // Handle ISO dates vs 'latest' (treat non-ISO as last).
        const at = new Date(a).getTime();
        const bt = new Date(b).getTime();
        const aOk = Number.isFinite(at);
        const bOk = Number.isFinite(bt);
        if (aOk && bOk) return at - bt;
        if (aOk) return -1;
        if (bOk) return 1;
        return a.localeCompare(b);
    });

    return dates.map((date) => aggregateRunSnapshot(groupMap.get(date) ?? [], date));
}

export function makeAllSubscription(
    subscriptions: TenantSubscription[],
    fallbackDates: string[]
): TenantSubscription {
    const resourceGroups = Array.from(
        new Set(subscriptions.flatMap((s) => s.resourceGroups ?? []))
    ).sort();

    const dates = Array.from(
        new Set(
            (subscriptions.flatMap((s) => s.dates ?? [])).concat(fallbackDates)
        )
    ).sort();

    return {
        id: 'all',
        name: 'All Subscriptions',
        resourceGroups,
        dates,
    };
}

