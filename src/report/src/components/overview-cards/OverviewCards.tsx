import { useState, useEffect, useMemo } from 'react';
import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { fetchRunSnapshot, fetchAllSnapshots } from '@/services/blobService';
import { ComplianceCard } from './ComplianceCard';
import { GovernanceCard } from './GovernanceCard';
import { DefenderCard } from './DefenderCard';
import { TrendSparkCards } from './TrendSparkCards';
import { SecurityScoreGauge } from './SecurityScoreGauge';
import { ComplianceDeepDiveCard } from './ComplianceDeepDiveCard';
import { PolicyExplorerCard } from './PolicyExplorerCard';
import { RecommendationsCard } from './RecommendationsCard';
import { GovernanceRulesCard } from './GovernanceRulesCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { RunSnapshot, TenantSubscription } from '@/types/assessment';
import { Activity, Sparkles } from 'lucide-react';

interface SubscriptionData {
    sub: TenantSubscription;
    latestSnapshot: RunSnapshot | null;
    allSnapshots: RunSnapshot[];
}

export function OverviewCards() {
    const {
        filters,
        availableSubscriptions,
        availableDates,
        loading: globalLoading,
    } = useGlobalFilters();

    const [subDataMap, setSubDataMap] = useState<Record<string, SubscriptionData>>({});
    const [loading, setLoading] = useState(true);

    // Fetch data for all subscriptions so each card can pick its own
    useEffect(() => {
        if (!filters.tenantId || availableSubscriptions.length === 0 || availableDates.length === 0) {
            setSubDataMap({});
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);

        const latestDate = availableDates[availableDates.length - 1];

        const tasks = availableSubscriptions.map(async (sub) => {
            const subDates = sub.dates ?? availableDates;
            const latestSubDate = subDates[subDates.length - 1] ?? latestDate;
            const [latest, all] = await Promise.all([
                fetchRunSnapshot(filters.tenantId, sub.id, latestSubDate).catch(() => null),
                fetchAllSnapshots(filters.tenantId, sub.id, subDates.slice(-6)).catch(() => []),
            ]);
            return { sub, latestSnapshot: latest, allSnapshots: all };
        });

        Promise.all(tasks).then((results) => {
            if (cancelled) return;
            const map: Record<string, SubscriptionData> = {};
            results.forEach((r) => { map[r.sub.id] = r; });
            setSubDataMap(map);
            setLoading(false);
        });

        return () => { cancelled = true; };
    }, [filters.tenantId, availableSubscriptions, availableDates]);

    /* Get ZT data for the score gauge from the first subscription with data */
    const ztData = useMemo(() => {
        const targetId = filters.subscriptionId || Object.keys(subDataMap)[0];
        return subDataMap[targetId]?.latestSnapshot?.zeroTrust ?? null;
    }, [subDataMap, filters.subscriptionId]);

    if (globalLoading) return null;

    return (
        <div className="w-full max-w-7xl mt-12 space-y-8">
            {/* ── Section header ── */}
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 ring-1 ring-cyan-500/20">
                    <Activity className="size-5 text-cyan-500" />
                </div>
                <div>
                    <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                        Security Posture at a Glance
                        <Sparkles className="size-4 text-yellow-400 animate-pulse" />
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Real-time compliance, governance &amp; threat metrics — filter per card
                    </p>
                </div>
            </div>

            {/* ── Loading skeletons ── */}
            {loading && (
                <div className="space-y-6">
                    <Skeleton className="h-[160px] rounded-2xl" />
                    <div className="grid gap-5 md:grid-cols-3">
                        {[0, 1, 2].map(i => (
                            <div key={i} className="glass-card gradient-border p-6 space-y-4 min-h-[300px]">
                                <div className="flex items-center gap-3">
                                    <Skeleton className="h-9 w-9 rounded-lg" />
                                    <Skeleton className="h-5 w-32" />
                                    <Skeleton className="h-7 w-28 ml-auto rounded-lg" />
                                </div>
                                <Skeleton className="h-28 w-full rounded-xl" />
                                <div className="space-y-2">
                                    {[0, 1, 2, 3].map(j => <Skeleton key={j} className="h-4 w-full rounded" />)}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
                        <Skeleton className="h-[350px] rounded-2xl" />
                        <Skeleton className="h-[350px] rounded-2xl" />
                    </div>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[140px] rounded-2xl" />)}
                    </div>
                </div>
            )}

            {/* ── Main content ── */}
            {!loading && Object.keys(subDataMap).length > 0 && (
                <>
                    {/* 1. Zero Trust Score Gauge — full width hero */}
                    <SecurityScoreGauge data={ztData} />

                    {/* 2. Original summary cards — 3 column */}
                    <div className="grid gap-5 grid-cols-1 md:grid-cols-3">
                        <ComplianceCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                        <GovernanceCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                        <DefenderCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                    </div>

                    {/* 3. Deep-dive section — 2 column, compliance focused */}
                    <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
                        <ComplianceDeepDiveCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                        <PolicyExplorerCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                    </div>

                    {/* 4. Recommendations & Governance detail — 2 column */}
                    <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
                        <RecommendationsCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                        <GovernanceRulesCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                    </div>

                    {/* 5. Trend sparklines */}
                    <TrendSparkCards
                        subscriptions={availableSubscriptions}
                        subDataMap={subDataMap}
                        defaultSubId={filters.subscriptionId}
                    />
                </>
            )}

            {/* ── Empty state ── */}
            {!loading && Object.keys(subDataMap).length === 0 && (
                <div className="glass-card gradient-border p-10 text-center">
                    <Activity className="size-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                    <p className="text-sm text-muted-foreground">
                        Select a tenant from the global filter bar to view security posture data.
                    </p>
                </div>
            )}
        </div>
    );
}
