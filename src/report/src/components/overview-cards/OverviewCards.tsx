import { useState, useEffect, useMemo, memo } from 'react';
import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { fetchRunSnapshot, fetchAllSnapshots } from '@/services/blobService';
import { ComplianceCard as _ComplianceCard } from './ComplianceCard';
import { GovernanceCard as _GovernanceCard } from './GovernanceCard';
import { DefenderCard as _DefenderCard } from './DefenderCard';
import { TrendSparkCards as _TrendSparkCards } from './TrendSparkCards';
import { SecurityScoreGauge as _SecurityScoreGauge } from './SecurityScoreGauge';

import { PolicyExplorerCard as _PolicyExplorerCard } from './PolicyExplorerCard';
import { RecommendationsCard as _RecommendationsCard } from './RecommendationsCard';
import { GovernanceRulesCard as _GovernanceRulesCard } from './GovernanceRulesCard';
import { StorageAccountsCard as _StorageAccountsCard } from './StorageAccountsCard';

const ComplianceCard = memo(_ComplianceCard);
const GovernanceCard = memo(_GovernanceCard);
const DefenderCard = memo(_DefenderCard);
const TrendSparkCards = memo(_TrendSparkCards);
const SecurityScoreGauge = memo(_SecurityScoreGauge);

const PolicyExplorerCard = memo(_PolicyExplorerCard);
const RecommendationsCard = memo(_RecommendationsCard);
const GovernanceRulesCard = memo(_GovernanceRulesCard);
const StorageAccountsCard = memo(_StorageAccountsCard);
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

        const tasks = availableSubscriptions.map(async (sub) => {
            // Always use the dedicated 'latest' folder for the most recent snapshot
            const [latest, all] = await Promise.all([
                fetchRunSnapshot(filters.tenantId, sub.id, 'latest').catch(() => null),
                fetchAllSnapshots(
                    filters.tenantId,
                    sub.id,
                    (sub.dates ?? availableDates).slice(-3)
                ).catch(() => []),
            ]);
            // Ensure historical/trend-style cards always include the latest snapshot
            // even if `tenant-index.json` is temporarily behind.
            const mergedAll = (() => {
                if (!latest) return all;
                const byDate = new Map<string, RunSnapshot>();
                for (const s of [...all, latest]) byDate.set(s.date, s);
                return Array.from(byDate.values()).sort(
                    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
                );
            })();

            return { sub, latestSnapshot: latest, allSnapshots: mergedAll };
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
                <div className="space-y-8 w-full animate-in fade-in duration-500 dashboard-grid-stagger">
                    {/* 1. Zero Trust Score Gauge */}
                    <Skeleton className="h-[220px] rounded-3xl glass-card shimmer" />
                    
                    {/* 2. Original summary cards */}
                    <div className="grid gap-5 grid-cols-1 md:grid-cols-3">
                        {[0, 1, 2].map(i => (
                            <div key={i} className="glass-card p-6 flex flex-col gap-4 h-[380px]">
                                <div className="flex items-center gap-3">
                                    <Skeleton className="h-10 w-10 rounded-xl shimmer" />
                                    <Skeleton className="h-6 w-32 shimmer" />
                                </div>
                                <Skeleton className="h-[180px] w-full rounded-2xl mt-auto shimmer" />
                            </div>
                        ))}
                    </div>

                    {/* 3. Deep-dive section */}
                    <div className="grid gap-5 grid-cols-1">
                        <Skeleton className="h-[420px] rounded-3xl glass-card shimmer" />
                    </div>

                    {/* 4. Recommendations, Governance detail & Storage Accounts — 2 column */ }
                    <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
                        {[0, 1, 2].map(i => <Skeleton key={i} className="h-[420px] rounded-3xl glass-card shimmer" />)}
                    </div>

                    {/* 5. Trend sparklines */}
                    <Skeleton className="h-[180px] rounded-3xl glass-card shimmer" />
                </div>
            )}

            {/* ── Main content ── */}
            {!loading && Object.keys(subDataMap).length > 0 && (
                <>
                    {/* 1. Zero Trust Score Gauge — full width hero */}
                    <div className="dashboard-stagger-single">
                        <SecurityScoreGauge data={ztData} />
                    </div>

                    {/* 2. Original summary cards — 3 column */}
                    <div className="grid gap-5 grid-cols-1 md:grid-cols-3 dashboard-grid-stagger">
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

                    {/* 3. Deep-dive section — policy explorer */}
                    <div className="grid gap-5 grid-cols-1 dashboard-grid-stagger">
                        <PolicyExplorerCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                    </div>

                    {/* 4. Recommendations & Governance detail — 2 column */}
                    <div className="grid gap-5 grid-cols-1 lg:grid-cols-2 dashboard-grid-stagger">
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
                        <StorageAccountsCard
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                    </div>

                    {/* 5. Trend sparklines */}
                    <div className="dashboard-stagger-single">
                        <TrendSparkCards
                            subscriptions={availableSubscriptions}
                            subDataMap={subDataMap}
                            defaultSubId={filters.subscriptionId}
                        />
                    </div>
                </>
            )}

            {/* ── Empty state ── */}
            {!loading && Object.keys(subDataMap).length === 0 && (
                <div className="glass-card gradient-border p-10 text-center animate-in fade-in slide-in-from-bottom-2 duration-700">
                    <Activity className="size-10 text-muted-foreground mx-auto mb-3 opacity-30 animate-pulse" />
                    <p className="text-sm text-muted-foreground/80">
                        Select a tenant from the global filter bar to view security posture data.
                    </p>
                </div>
            )}
        </div>
    );
}
