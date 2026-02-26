import { useState, useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip as ReTooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, BarChart3, ChevronDown, ChevronUp, Filter, Info } from 'lucide-react';
import { ChartContainer } from '@/components/ui/chart';
import type { RunSnapshot } from '@/types/assessment';
import type { TenantSubscription } from '@/types/assessment';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

interface SubDataEntry {
    sub: TenantSubscription;
    latestSnapshot: RunSnapshot | null;
    allSnapshots: RunSnapshot[];
}

interface Props {
    subscriptions: TenantSubscription[];
    subDataMap: Record<string, SubDataEntry>;
    defaultSubId: string;
}

interface SparkMetric {
    key: string;
    label: string;
    description: string;
    color: string;
    gradientFrom: string;
    gradientTo: string;
    values: { date: string; v: number }[];
    current: number;
    delta: number;
    invertDelta: boolean;
    format: (v: number) => string;
}

function extractMetrics(snapshots: RunSnapshot[]): SparkMetric[] {
    if (snapshots.length === 0) return [];

    const ztValues = snapshots.map(s => ({ date: s.date, v: s.zeroTrust.overallScore }));
    const ztCurrent = ztValues[ztValues.length - 1].v;
    const ztPrev = ztValues.length >= 2 ? ztValues[ztValues.length - 2].v : ztCurrent;

    const compValues = snapshots.map(s => {
        const tot = s.policyCompliance.initiatives.reduce(
            (acc, i) => ({ comp: acc.comp + i.compliantCount, total: acc.total + i.compliantCount + i.nonCompliantCount + i.exemptCount }),
            { comp: 0, total: 0 },
        );
        return { date: s.date, v: tot.total > 0 ? Math.round((tot.comp / tot.total) * 100) : 0 };
    });
    const compCurrent = compValues[compValues.length - 1].v;
    const compPrev = compValues.length >= 2 ? compValues[compValues.length - 2].v : compCurrent;

    const recValues = snapshots.map(s => ({ date: s.date, v: s.defenderRecs.recommendations.length }));
    const recCurrent = recValues[recValues.length - 1].v;
    const recPrev = recValues.length >= 2 ? recValues[recValues.length - 2].v : recCurrent;

    const govValues = snapshots.map(s => {
        const rules = s.governance.rules;
        if (rules.length === 0) return { date: s.date, v: 0 };
        return { date: s.date, v: Math.round(rules.reduce((sum, r) => sum + r.completionPercentage, 0) / rules.length) };
    });
    const govCurrent = govValues[govValues.length - 1].v;
    const govPrev = govValues.length >= 2 ? govValues[govValues.length - 2].v : govCurrent;

    return [
        {
            key: 'zt', label: 'Zero Trust Score',
            description: 'Overall Zero Trust maturity score based on pillar checks',
            color: '#3b82f6', gradientFrom: '#3b82f640', gradientTo: '#3b82f605',
            values: ztValues, current: ztCurrent, delta: ztCurrent - ztPrev,
            invertDelta: false, format: v => `${v}`,
        },
        {
            key: 'comp', label: 'Policy Compliance',
            description: 'Percentage of resources compliant with assigned policy sets',
            color: '#22c55e', gradientFrom: '#22c55e40', gradientTo: '#22c55e05',
            values: compValues, current: compCurrent, delta: compCurrent - compPrev,
            invertDelta: false, format: v => `${v}%`,
        },
        {
            key: 'recs', label: 'Open Defender Recs',
            description: 'Number of open Defender for Cloud recommendations (lower is better)',
            color: '#f97316', gradientFrom: '#f9731640', gradientTo: '#f9731605',
            values: recValues, current: recCurrent, delta: recCurrent - recPrev,
            invertDelta: true, format: v => `${v}`,
        },
        {
            key: 'gov', label: 'Governance Progress',
            description: 'Average completion % across all governance rules',
            color: '#8b5cf6', gradientFrom: '#8b5cf640', gradientTo: '#8b5cf605',
            values: govValues, current: govCurrent, delta: govCurrent - govPrev,
            invertDelta: false, format: v => `${v}%`,
        },
    ];
}

const CustomSparkTooltip = ({ active, payload, label, color }: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
    color: string;
    format: (v: number) => string;
}) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-xl border bg-background/95 backdrop-blur px-3 py-2 text-xs shadow-xl">
            <div className="text-muted-foreground text-[10px] mb-0.5">
                {label ? new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
            </div>
            <div className="font-bold" style={{ color }}>{payload[0].value}</div>
        </div>
    );
};

function DeltaBadge({ delta, invert = false }: { delta: number; invert?: boolean }) {
    const isGood = invert ? delta < 0 : delta > 0;
    const isBad = invert ? delta > 0 : delta < 0;

    if (delta === 0) return (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
            <Minus className="size-2.5" /> 0
        </span>
    );

    return (
        <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${isGood ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : isBad ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-muted text-muted-foreground'}`}>
            {delta > 0 ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
            {delta > 0 ? '+' : ''}{delta}
        </span>
    );
}

function SparkCard({ metric, subId, setSubId, subscriptions }: {
    metric: SparkMetric;
    subId: string;
    setSubId: (id: string) => void;
    subscriptions: TenantSubscription[];
}) {
    const [expanded, setExpanded] = useState(false);
    const chartData = metric.values;

    const gradId = `grad-${metric.key}`;

    return (
        <TooltipProvider delayDuration={100}>
            <div
                className="glass-card gradient-border scan-line cursor-pointer flex flex-col gap-0"
                onClick={() => setExpanded(v => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setExpanded(v => !v)}
            >
                {/* Header */}
                <div className="px-4 pt-4 pb-2">
                    <div className="flex items-start justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {metric.label}
                            </span>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button onClick={e => e.stopPropagation()}>
                                        <Info className="size-3 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[200px] text-xs">
                                    {metric.description}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <DeltaBadge delta={metric.delta} invert={metric.invertDelta} />
                            {expanded ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                        </div>
                    </div>

                    {/* On-card sub filter */}
                    <div className="flex items-center gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
                        <Filter className="size-2.5 text-muted-foreground shrink-0" />
                        <select
                            value={subId}
                            onChange={e => setSubId(e.target.value)}
                            className="h-6 w-full rounded-md border bg-background/80 px-1.5 text-[10px] font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            {subscriptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                </div>

                {/* Big number */}
                <div className="px-4 pb-2">
                    <div className="text-3xl font-bold tracking-tight tabular-nums stat-glow" style={{ color: metric.color }}>
                        {metric.format(metric.current)}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                        vs. prev: {metric.format(metric.current - metric.delta)}
                    </div>
                </div>

                {/* Mini sparkline */}
                <div className="px-1 pb-2">
                    <ChartContainer
                        config={{ v: { label: metric.label, color: metric.color } }}
                        className="h-14 w-full"
                    >
                        <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
                            <Line
                                type="monotone"
                                dataKey="v"
                                stroke={metric.color}
                                strokeWidth={2}
                                dot={false}
                                animationDuration={600}
                                strokeLinecap="round"
                            />
                            <ReTooltip
                                content={<CustomSparkTooltip color={metric.color} format={metric.format} />}
                                cursor={{ stroke: metric.color, strokeWidth: 1, strokeDasharray: '3 3' }}
                            />
                        </LineChart>
                    </ChartContainer>
                </div>

                {/* Expanded: full area chart */}
                <div className="expand-panel" data-open={expanded}>
                    <div>
                        <div className="border-t px-4 pt-3 pb-4">
                            <div className="flex items-center gap-2 mb-3">
                                <BarChart3 className="size-3.5" style={{ color: metric.color }} />
                                <h4 className="text-xs font-semibold text-muted-foreground">
                                    Trend over {chartData.length} snapshots
                                </h4>
                            </div>
                            <div className="h-36">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData} margin={{ top: 6, right: 8, bottom: 4, left: 8 }}>
                                        <defs>
                                            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="10%" stopColor={metric.gradientFrom} stopOpacity={1} />
                                                <stop offset="100%" stopColor={metric.gradientTo} stopOpacity={1} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,0.12)" />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fontSize: 9 }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 9 }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={28}
                                        />
                                        <ReTooltip content={<CustomSparkTooltip color={metric.color} format={metric.format} />} />
                                        <Area
                                            type="monotone"
                                            dataKey="v"
                                            stroke={metric.color}
                                            strokeWidth={2.5}
                                            fill={`url(#${gradId})`}
                                            dot={{ r: 3, fill: metric.color, strokeWidth: 0 }}
                                            activeDot={{ r: 5, fill: metric.color, stroke: '#fff', strokeWidth: 2 }}
                                            animationDuration={700}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Data points summary */}
                            <div className="grid grid-cols-3 gap-2 mt-3">
                                {[
                                    { label: 'Min', val: Math.min(...chartData.map(d => d.v)) },
                                    { label: 'Max', val: Math.max(...chartData.map(d => d.v)) },
                                    { label: 'Avg', val: Math.round(chartData.reduce((s, d) => s + d.v, 0) / (chartData.length || 1)) },
                                ].map(({ label, val }) => (
                                    <div key={label} className="text-center rounded-lg bg-muted/40 py-1.5">
                                        <div className="text-[10px] text-muted-foreground">{label}</div>
                                        <div className="text-sm font-semibold" style={{ color: metric.color }}>
                                            {metric.format(val)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </TooltipProvider>
    );
}

export function TrendSparkCards({ subscriptions, subDataMap, defaultSubId }: Props) {
    // Each spark card has its own subscription selection
    const [subIds, setSubIds] = useState<Record<string, string>>({
        zt: defaultSubId || subscriptions[0]?.id || '',
        comp: defaultSubId || subscriptions[0]?.id || '',
        recs: defaultSubId || subscriptions[0]?.id || '',
        gov: defaultSubId || subscriptions[0]?.id || '',
    });

    const metricsMap = useMemo(() => {
        const result: Record<string, SparkMetric[]> = {};
        Object.entries(subIds).forEach(([key, sid]) => {
            const snapshots = subDataMap[sid]?.allSnapshots ?? [];
            const all = extractMetrics(snapshots);
            const found = all.find(m => m.key === key);
            if (found) result[key] = [found];
        });
        return result;
    }, [subIds, subDataMap]);

    const allMetricsForDefaultSub = useMemo(() => {
        const snapshots = subDataMap[defaultSubId]?.allSnapshots ?? [];
        return extractMetrics(snapshots);
    }, [subDataMap, defaultSubId]);

    if (allMetricsForDefaultSub.length === 0 && Object.values(subDataMap).every(d => d.allSnapshots.length === 0)) {
        return (
            <div className="glass-card gradient-border p-6 text-center text-sm text-muted-foreground">
                <TrendingUp className="size-8 mx-auto mb-2 opacity-40" />
                No trend data available yet — data populates as scans accumulate over time.
            </div>
        );
    }

    // Merge: use per-card subscription metric if available, else fall back to default
    const metricsToRender = allMetricsForDefaultSub.map(m => {
        const perCardMetric = metricsMap[m.key]?.[0];
        return perCardMetric || m;
    });

    return (
        <div>
            <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="size-4 text-violet-500" />
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Trends Over Time
                </h3>
                <span className="text-[10px] text-muted-foreground ml-1">— per-card subscription filter</span>
            </div>
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                {metricsToRender.map((m) => (
                    <SparkCard
                        key={m.key}
                        metric={m}
                        subId={subIds[m.key] || defaultSubId}
                        setSubId={(id) => setSubIds(prev => ({ ...prev, [m.key]: id }))}
                        subscriptions={subscriptions}
                    />
                ))}
            </div>
        </div>
    );
}
