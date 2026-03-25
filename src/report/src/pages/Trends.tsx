import { useState, useEffect, useReducer, useCallback, useMemo } from 'react';
import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { fetchAllSnapshots, fetchRunSnapshot } from '@/services/blobService';
import { TrendsFilterBar } from '@/components/trends/TrendsFilterBar';
import { PostureScoreTimeline } from '@/components/trends/PostureScoreTimeline';
import { StackedAreaCards } from '@/components/trends/StackedAreaCards';
import { GovernanceBurnDown } from '@/components/trends/GovernanceBurnDown';
import { ComplianceHeatmap } from '@/components/trends/ComplianceHeatmap';
import { RunOverRunDelta } from '@/components/trends/RunOverRunDelta';
import { AnomalyAlertCards } from '@/components/trends/AnomalyAlertCards';
import {
    extractTrendData,
    extractPolicyComposition,
    extractDefenderSeverity,
    extractBurnDown,
    extractHeatmapData,
    computeDelta,
    detectAnomalies,
} from '@/lib/trends-utils';
import { getMappedPolicyName } from '@/lib/policy-mapping';
import type { RunSnapshot, TrendsFilterState } from '@/types/assessment';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

const defaultTrendsFilter: TrendsFilterState = {
    subscriptionId: '',
    resourceGroupId: '',
    dataSource: 'all',
    dateRange: [
        new Date(new Date().setMonth(new Date().getMonth() - 6)),
        new Date(),
    ],
    granularity: 'monthly',
    compareSubscriptionId: '',
};

export default function Trends() {
    const {
        filters,
        availableSubscriptions,
        availableResourceGroups,
        availableDates,
        loading: globalLoading,
        policyMapping,
    } = useGlobalFilters();

    const [trendsFilter, updateTrendsFilter] = useReducer(
        (state: TrendsFilterState, partial: Partial<TrendsFilterState>) => ({
            ...state,
            ...partial,
        }),
        defaultTrendsFilter,
    );

    const [snapshots, setSnapshots] = useState<RunSnapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Sync the trends-local subscription filter with the global one
    useEffect(() => {
        if (filters.subscriptionId) {
            updateTrendsFilter({ subscriptionId: filters.subscriptionId });
        }
    }, [filters.subscriptionId]);

    // Fetch all snapshots when tenant/subscription/dates change
    useEffect(() => {
        if (!filters.tenantId || availableDates.length === 0) {
            setSnapshots([]);
            setLoading(false);
            return;
        }

        // Determine which subscriptions to load
        const subsToLoad = filters.subscriptionId
            ? [filters.subscriptionId]
            : availableSubscriptions.map(s => s.id);

        if (subsToLoad.length === 0) {
            setSnapshots([]);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        // Fetch snapshots for each subscription and merge
        const fetchForSub = async (subId: string) => {
            const subDates = availableSubscriptions.find(s => s.id === subId)?.dates ?? availableDates;
            const [data, latestSnapshot] = await Promise.all([
                fetchAllSnapshots(filters.tenantId, subId, subDates),
                fetchRunSnapshot(filters.tenantId, subId, 'latest').catch(() => null),
            ]);
            if (!latestSnapshot) return data;
            const byDate = new Map<string, RunSnapshot>();
            for (const s of [...data, latestSnapshot]) byDate.set(s.date, s);
            return Array.from(byDate.values()).sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );
        };

        Promise.all(subsToLoad.map(fetchForSub))
            .then((results) => {
                if (cancelled) return;
                // Merge snapshots by date — pick the first subscription's data per date
                const byDate = new Map<string, RunSnapshot>();
                for (const subSnapshots of results) {
                    for (const snap of subSnapshots) {
                        if (!byDate.has(snap.date)) {
                            byDate.set(snap.date, snap);
                        }
                    }
                }
                const merged = Array.from(byDate.values()).sort(
                    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
                );
                setSnapshots(merged);
            })
            .catch((err) => {
                if (!cancelled) setError(String(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [filters.tenantId, filters.subscriptionId, availableSubscriptions, availableDates]);

    // ─── Filter snapshots by date range ───────────────────────────────
    const filteredSnapshots = useMemo(() => {
        const [start, end] = trendsFilter.dateRange;
        return snapshots.filter((s) => {
            const d = new Date(s.date);
            return d >= start && d <= end;
        });
    }, [snapshots, trendsFilter.dateRange]);

    // ─── Apply policy mapping to snapshots before extraction ──────────
    const mappedSnapshots = useMemo(() => {
        return filteredSnapshots.map(snap => ({
            ...snap,
            policyCompliance: {
                ...snap.policyCompliance,
                initiatives: snap.policyCompliance.initiatives.map(init => ({
                    ...init,
                    name: getMappedPolicyName(init.id, init.name, policyMapping),
                    resources: init.resources.map(res => ({
                        ...res,
                        failingPolicies: res.failingPolicies.map(fp => ({
                            ...fp,
                            name: getMappedPolicyName(fp.id, fp.name, policyMapping)
                        }))
                    }))
                }))
            }
        }));
    }, [filteredSnapshots, policyMapping]);

    // ─── Derived trend data ───────────────────────────────────────────
    const trendData = useMemo(() => extractTrendData(mappedSnapshots), [mappedSnapshots]);
    const policyComposition = useMemo(() => extractPolicyComposition(mappedSnapshots), [mappedSnapshots]);
    const defenderSeverity = useMemo(() => extractDefenderSeverity(mappedSnapshots), [mappedSnapshots]);
    const burnDown = useMemo(() => extractBurnDown(mappedSnapshots), [mappedSnapshots]);
    const heatmapRows = useMemo(() => extractHeatmapData(mappedSnapshots), [mappedSnapshots]);
    const heatmapDates = useMemo(() => mappedSnapshots.map((s) => s.date), [mappedSnapshots]);
    const anomalyAlerts = useMemo(() => detectAnomalies(mappedSnapshots), [mappedSnapshots]);

    const deltaRows = useMemo(() => {
        if (mappedSnapshots.length < 2) return null;
        const prev = mappedSnapshots[mappedSnapshots.length - 2];
        const curr = mappedSnapshots[mappedSnapshots.length - 1];
        return { date1: prev.date, date2: curr.date, rows: computeDelta(prev, curr) };
    }, [mappedSnapshots]);

    const handleTrendsUpdate = useCallback(
        (partial: Partial<TrendsFilterState>) => updateTrendsFilter(partial),
        [],
    );

    // ─── Loading / Error states ───────────────────────────────────────
    if (globalLoading || loading) {
        return (
            <div className="py-6 space-y-6" aria-label="Loading trends data">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-[350px] w-full rounded-lg" />
                <div className="grid gap-6 lg:grid-cols-2">
                    <Skeleton className="h-[300px] rounded-lg" />
                    <Skeleton className="h-[300px] rounded-lg" />
                </div>
                <Skeleton className="h-[300px] w-full rounded-lg" />
            </div>
        );
    }

    if (error) {
        return (
            <Card className="my-6">
                <CardContent className="py-8 text-center">
                    <p className="text-sm text-destructive">
                        Failed to load trend data. {error}
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (filteredSnapshots.length === 0) {
        return (
            <Card className="my-6">
                <CardContent className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                        No snapshot data available for the selected filters. Select a tenant from the global filter bar to view trend data.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="py-6 space-y-6">
            {/* Trends-tab filter bar */}
            <TrendsFilterBar
                filters={trendsFilter}
                subscriptions={availableSubscriptions}
                resourceGroups={availableResourceGroups}
                onUpdate={handleTrendsUpdate}
            />

            {/* Card 1 — Overall Posture Score Timeline */}
            <PostureScoreTimeline data={trendData} />

            {/* Card 2 — Stacked Area Cards */}
            <StackedAreaCards
                policyData={policyComposition}
                defenderData={defenderSeverity}
            />

            {/* Card 3 — Governance Burn-Down */}
            <GovernanceBurnDown data={burnDown} />

            {/* Card 4 — Compliance Heatmap */}
            <ComplianceHeatmap rows={heatmapRows} dates={heatmapDates} />

            {/* Card 5 — Run-over-Run Delta */}
            {deltaRows && (
                <RunOverRunDelta
                    date1={deltaRows.date1}
                    date2={deltaRows.date2}
                    rows={deltaRows.rows}
                />
            )}

            {/* Card 6 — Anomaly & Regression Alerts */}
            <AnomalyAlertCards alerts={anomalyAlerts} />
        </div>
    );
}
