import { useState, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, Cell,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { Shield, ChevronDown, ChevronUp, Zap, Filter, Info, ExternalLink, Server, FolderOpen } from 'lucide-react';
import type { DefenderRecs, Severity } from '@/types/assessment';
import type { TenantSubscription, RunSnapshot } from '@/types/assessment';
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

const SEVERITY_CONFIG: Record<Severity, { label: string; color: string; bg: string }> = {
    critical: { label: 'Critical', color: '#ef4444', bg: '#ef444418' },
    high: { label: 'High', color: '#f97316', bg: '#f9731618' },
    medium: { label: 'Medium', color: '#eab308', bg: '#eab30818' },
    low: { label: 'Low', color: '#22c55e', bg: '#22c55e18' },
};

const CustomBarTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number; color: string } }> }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="rounded-xl border bg-background/95 backdrop-blur px-3 py-2 text-xs shadow-xl">
            <div className="font-semibold" style={{ color: d.color }}>{d.name}</div>
            <div className="text-muted-foreground">{d.value} recommendations</div>
        </div>
    );
};

export function DefenderCard({ subscriptions, subDataMap, defaultSubId }: Props) {
    const [expanded, setExpanded] = useState(false);
    const [subId, setSubId] = useState(defaultSubId || subscriptions[0]?.id || '');
    const [rgFilter, setRgFilter] = useState('');
    const [sevFilter, setSevFilter] = useState<Severity | ''>('');

    const data: DefenderRecs | null = subDataMap[subId]?.latestSnapshot?.defenderRecs ?? null;
    const sub = subscriptions.find(s => s.id === subId);
    const availableRGs = useMemo(() => sub?.resourceGroups ?? [], [sub]);

    const filteredRecs = useMemo(() => {
        if (!data) return [];
        return data.recommendations.filter(r => {
            if (sevFilter && r.severity !== sevFilter) return false;
            if (rgFilter) {
                const affectedInRG = r.affectedResources.some(ar => ar.resourceGroup === rgFilter);
                if (!affectedInRG) return false;
            }
            return true;
        });
    }, [data, sevFilter, rgFilter]);

    const stats = useMemo(() => {
        const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
        let attackPaths = 0;
        filteredRecs.forEach((r) => {
            counts[r.severity]++;
            if (r.hasAttackPath) attackPaths++;
        });
        return { counts, total: filteredRecs.length, attackPaths };
    }, [filteredRecs]);

    const hasCritical = stats.counts.critical > 0;
    const hasHigh = stats.counts.high > 0;
    const accentColor = hasCritical ? '#ef4444' : hasHigh ? '#f97316' : '#eab308';

    const barData = (Object.keys(SEVERITY_CONFIG) as Severity[]).map((sev) => ({
        name: SEVERITY_CONFIG[sev].label,
        value: stats.counts[sev],
        color: SEVERITY_CONFIG[sev].color,
        sev,
    }));

    if (!data) {
        return (
            <TooltipProvider>
                <div className="glass-card gradient-border scan-line p-6 flex flex-col items-center justify-center min-h-[300px] gap-3">
                    <Shield className="size-10 text-muted-foreground/40" />
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <Filter className="size-3.5 text-muted-foreground" />
                        <select
                            value={subId}
                            onChange={e => setSubId(e.target.value)}
                            className="h-7 rounded-lg border bg-background/80 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            {subscriptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <span className="text-sm text-muted-foreground">No Defender data</span>
                </div>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider delayDuration={150}>
            <div
                className={`glass-card gradient-border scan-line cursor-pointer ${hasCritical ? 'glow-warning' : ''}`}
                onClick={() => setExpanded(v => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setExpanded(v => !v)}
            >
                {/* ─── Header ─── */}
                <div className="flex items-start justify-between px-5 pt-5 pb-3 gap-2">
                    <div className="flex items-center gap-2.5">
                        <div
                            className="p-2 rounded-lg ring-1 ring-inset"
                            style={{ background: hasCritical ? '#ef444418' : '#f9731618' }}
                        >
                            <Shield className="size-5" style={{ color: accentColor }} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground leading-none">
                                Defender Recommendations
                            </h3>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                {stats.total} open · {stats.attackPaths > 0 ? `${stats.attackPaths} attack paths ⚡` : 'no attack paths'}
                            </p>
                        </div>
                    </div>
                    <span className="text-muted-foreground shrink-0">
                        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </span>
                </div>

                {/* ─── On-card filters ─── */}
                <div
                    className="flex items-center gap-2 px-5 pb-3 flex-wrap"
                    onClick={e => e.stopPropagation()}
                >
                    <Filter className="size-3 text-muted-foreground shrink-0" />
                    <select
                        value={subId}
                        onChange={e => { setSubId(e.target.value); setRgFilter(''); setSevFilter(''); }}
                        className="h-7 max-w-[140px] rounded-lg border bg-background/80 px-2 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-ring truncate"
                    >
                        {subscriptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {availableRGs.length > 0 && (
                        <select
                            value={rgFilter}
                            onChange={e => setRgFilter(e.target.value)}
                            className="h-7 max-w-[120px] rounded-lg border bg-background/80 px-2 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            <option value="">All RGs</option>
                            {availableRGs.map(rg => <option key={rg} value={rg}>{rg}</option>)}
                        </select>
                    )}
                    <select
                        value={sevFilter}
                        onChange={e => setSevFilter(e.target.value as Severity | '')}
                        className="h-7 rounded-lg border bg-background/80 px-2 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                        style={sevFilter ? { borderColor: SEVERITY_CONFIG[sevFilter].color, color: SEVERITY_CONFIG[sevFilter].color } : {}}
                    >
                        <option value="">All Severities</option>
                        {(Object.keys(SEVERITY_CONFIG) as Severity[]).map(s => (
                            <option key={s} value={s}>{SEVERITY_CONFIG[s].label}</option>
                        ))}
                    </select>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                                <Info className="size-3.5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                            Open recommendations from Microsoft Defender for Cloud. Attack paths indicate exploitable chains.
                        </TooltipContent>
                    </Tooltip>
                </div>

                {/* ─── Bar chart + big number ─── */}
                <div className="flex items-center gap-5 px-5 pb-5">
                    <ChartContainer
                        config={{ value: { label: 'Count' } }}
                        className="w-40 h-28 shrink-0"
                    >
                        <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 10, top: 2, bottom: 2 }}>
                            <XAxis type="number" hide />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={50}
                                tick={{ fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Bar
                                dataKey="value"
                                radius={[0, 4, 4, 0]}
                                animationDuration={800}
                                onClick={(d) => setSevFilter(sevFilter === d.sev ? '' : d.sev)}
                                cursor="pointer"
                            >
                                {barData.map((entry) => (
                                    <Cell
                                        key={entry.name}
                                        fill={entry.color}
                                        opacity={sevFilter && sevFilter !== entry.sev ? 0.3 : 1}
                                        style={{ filter: `drop-shadow(0 0 4px ${entry.color}50)` }}
                                    />
                                ))}
                            </Bar>
                            <ReTooltip content={<CustomBarTooltip />} cursor={{ fill: 'transparent' }} />
                        </BarChart>
                    </ChartContainer>

                    <div className="flex-1 space-y-2">
                        <div>
                            <div className="text-4xl font-bold tracking-tight tabular-nums stat-glow" style={{ color: accentColor }}>
                                {stats.total}
                            </div>
                            <p className="text-xs text-muted-foreground">open recommendations</p>
                        </div>

                        {stats.attackPaths > 0 && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                                style={{ background: '#ef444418', color: '#ef4444', border: '1px solid #ef444430' }}>
                                <Zap className="size-3.5 animate-pulse" />
                                {stats.attackPaths} attack {stats.attackPaths === 1 ? 'path' : 'paths'}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2 mt-1">
                            {(Object.keys(SEVERITY_CONFIG) as Severity[]).map((sev) => (
                                <Tooltip key={sev}>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSevFilter(sevFilter === sev ? '' : sev); }}
                                            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full transition-all hover:scale-105"
                                            style={{
                                                background: SEVERITY_CONFIG[sev].bg,
                                                color: SEVERITY_CONFIG[sev].color,
                                                opacity: sevFilter && sevFilter !== sev ? 0.4 : 1,
                                                border: `1px solid ${SEVERITY_CONFIG[sev].color}30`,
                                            }}
                                        >
                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SEVERITY_CONFIG[sev].color }} />
                                            {stats.counts[sev]}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="text-xs">
                                        {SEVERITY_CONFIG[sev].label}: {stats.counts[sev]} · click to filter
                                    </TooltipContent>
                                </Tooltip>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ─── Expand panel: recommendation list ─── */}
                <div className="expand-panel" data-open={expanded}>
                    <div>
                        <div className="border-t px-5 py-4 space-y-2 max-h-80 overflow-y-auto">
                            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                                <Shield className="size-3.5" /> Recommendations
                                <span className="ml-auto normal-case text-[10px] font-normal">
                                    {filteredRecs.length} shown
                                </span>
                            </h4>
                            {filteredRecs.slice(0, 15).map((rec) => {
                                const cfg = SEVERITY_CONFIG[rec.severity];
                                const rgSet = [...new Set(rec.affectedResources.map(r => r.resourceGroup))];
                                return (
                                    <Tooltip key={rec.id}>
                                        <TooltipTrigger asChild>
                                            <div
                                                className="flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm hover:bg-muted/50 transition-all hover:shadow-sm cursor-default"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <span
                                                    className="mt-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                                                    style={{ background: cfg.bg, color: cfg.color }}
                                                >
                                                    {cfg.label}
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium truncate">{rec.name}</p>
                                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                            <Server className="size-2.5" /> {rec.resourceCount} resources
                                                        </span>
                                                        {rgSet.length > 0 && (
                                                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                                <FolderOpen className="size-2.5" /> {rgSet.join(', ').slice(0, 30)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {rec.hasAttackPath && (
                                                    <Zap className="size-3.5 text-red-500 shrink-0 mt-0.5 animate-pulse" />
                                                )}
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="max-w-[300px] text-xs space-y-2">
                                            <p className="font-semibold">{rec.name}</p>
                                            <p className="text-muted-foreground text-[11px]">{rec.description}</p>
                                            <div className="space-y-0.5 pt-1 border-t">
                                                <p><span className="text-muted-foreground">Category:</span> {rec.category}</p>
                                                <p><span className="text-muted-foreground">Resources:</span> {rec.resourceCount}</p>
                                                {rec.hasAttackPath && (
                                                    <p className="text-red-400 flex items-center gap-1 font-semibold">
                                                        <Zap className="size-3" /> Attack path detected
                                                    </p>
                                                )}
                                                {rec.remediation && (
                                                    <p className="text-emerald-600 dark:text-emerald-400 font-medium pt-1">
                                                        Remediation: {rec.remediation}
                                                    </p>
                                                )}
                                            </div>
                                            {rec.affectedResources.slice(0, 3).map(r => (
                                                <div key={r.id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                    <Server className="size-2.5 shrink-0" />
                                                    <span className="truncate">{r.name}</span>
                                                    <span className="shrink-0 opacity-60">({r.resourceGroup})</span>
                                                </div>
                                            ))}
                                            {rec.learnMoreUrl && (
                                                <a
                                                    href={rec.learnMoreUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="flex items-center gap-1 text-blue-500 hover:underline text-[10px] pt-1"
                                                    onClick={e => e.stopPropagation()}
                                                >
                                                    <ExternalLink className="size-2.5" /> Learn more in Defender
                                                </a>
                                            )}
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            })}
                            {filteredRecs.length > 15 && (
                                <p className="text-center text-[11px] text-muted-foreground pt-1">
                                    +{filteredRecs.length - 15} more recommendations…
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </TooltipProvider>
    );
}
