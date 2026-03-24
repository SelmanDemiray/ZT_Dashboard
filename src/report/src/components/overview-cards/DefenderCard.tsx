import { useState, useMemo } from 'react';
import { displaySubName } from '@/lib/format-sub-name';
import { useShowMore } from '@/hooks/useShowMore';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, Cell,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { Shield, ChevronDown, ChevronUp, Zap, Filter, Info, ExternalLink, Server, FolderOpen, Maximize2 } from 'lucide-react';
import type { DefenderRecs, Severity } from '@/types/assessment';
import type { TenantSubscription, RunSnapshot } from '@/types/assessment';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { FilterDropdown } from '@/components/ui/FilterDropdown';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface SubDataEntry {
    sub: TenantSubscription;
    latestSnapshot: RunSnapshot | null;
    allSnapshots: RunSnapshot[];
}

interface Props {
    subscriptions: TenantSubscription[];
    subDataMap: Record<string, SubDataEntry>;
    defaultSubId: string;
    expanded?: boolean;
    onToggleExpanded?: () => void;
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

export function DefenderCard({ subscriptions, subDataMap, defaultSubId, expanded: propExpanded, onToggleExpanded }: Props) {
    const [localExpanded, setLocalExpanded] = useState(false);
    const expanded = propExpanded !== undefined ? propExpanded : localExpanded;
    const toggleExpanded = onToggleExpanded || (() => setLocalExpanded(v => !v));
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
                <div className="glass-card gradient-border scan-line p-6 flex flex-col items-center justify-center min-h-[300px] gap-3 transition-all duration-300">
                    <div className="relative">
                        <div className="absolute inset-0 bg-muted/20 animate-ping rounded-full" />
                        <Shield className="size-10 text-muted-foreground/40 relative z-10" />
                    </div>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <Filter className="size-3.5 text-muted-foreground" />
                        <FilterDropdown
                            value={subId}
                            onValueChange={v => setSubId(v)}
                            options={subscriptions.map(s => ({ value: s.id, label: displaySubName(s) }))}
                            className="max-w-[140px]"
                        />
                    </div>
                    <span className="text-sm text-muted-foreground">No Defender data</span>
                </div>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider delayDuration={150}>
            <div
                className={`glass-card gradient-border scan-line cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-border/60 ${hasCritical ? 'glow-warning' : ''}`}
                onClick={() => toggleExpanded()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && toggleExpanded()}
            >
                {/* ─── Header ─── */}
                <div className="flex items-start justify-between px-5 pt-5 pb-3 gap-2">
                    <div className="flex items-center gap-2.5">
                        <div
                            className="p-2 rounded-lg ring-1 ring-inset"
                            style={{ background: hasCritical ? '#ef444418' : '#f9731618' }}
                        >
                            <Shield className={`size-5 ${hasCritical ? 'animate-pulse' : ''}`} style={{ color: accentColor }} />
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
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <Dialog>
                            <DialogTrigger asChild>
                                <button className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted" title="Maximize">
                                    <Maximize2 className="size-3.5" />
                                </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 overflow-hidden bg-background/95 backdrop-blur border-muted z-50">
                                <DialogHeader className="p-6 border-b flex-shrink-0">
                                    <DialogTitle className="flex items-center gap-2">
                                        <Shield className="size-5" style={{ color: accentColor }} />
                                        Defender Recommendations
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                    <div className="flex items-center gap-8 pb-6 border-b">
                                        <ChartContainer
                                            config={{ value: { label: 'Count' } }}
                                            className="w-48 h-36 shrink-0"
                                        >
                                            <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 10, top: 2, bottom: 2 }}>
                                                <XAxis type="number" hide />
                                                <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                                    {barData.map((entry) => (
                                                        <Cell key={`bar-${entry.name}`} fill={entry.color} />
                                                    ))}
                                                </Bar>
                                                <ReTooltip content={<CustomBarTooltip />} cursor={{ fill: 'transparent' }} />
                                            </BarChart>
                                        </ChartContainer>
                                        <div className="flex-1 space-y-4">
                                            <div>
                                                <div className="text-5xl font-bold tracking-tight tabular-nums stat-glow" style={{ color: accentColor }}>
                                                    {stats.total}
                                                </div>
                                                <p className="text-sm text-muted-foreground">open recommendations</p>
                                            </div>
                                            {stats.attackPaths > 0 && (
                                                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold"
                                                    style={{ background: '#ef444418', color: '#ef4444', border: '1px solid #ef444430' }}>
                                                    <Zap className="size-4 animate-pulse" />
                                                    {stats.attackPaths} Attack Paths
                                                </div>
                                            )}
                                            <div className="flex gap-4 mt-2">
                                                {(Object.keys(SEVERITY_CONFIG) as Severity[]).map((sev) => (
                                                    <div key={`modal-sev-${sev}`} className="flex items-center gap-2">
                                                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_CONFIG[sev].color }} />
                                                        <span className="text-sm font-medium">{SEVERITY_CONFIG[sev].label}: {stats.counts[sev]}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <h4 className="font-semibold text-lg flex items-center gap-2">
                                            <Shield className="size-5 text-muted-foreground" /> Recommendations List
                                            <span className="ml-auto text-sm font-normal text-muted-foreground">{filteredRecs.length} available</span>
                                        </h4>
                                        <DefenderRecsList recs={filteredRecs} subscriptions={subscriptions} subId={subId} />
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                        <span className="text-muted-foreground shrink-0 p-1 rounded-md hover:bg-muted transition-colors cursor-pointer" onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}>
                            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </span>
                    </div>
                </div>

                {/* ─── On-card filters ─── */}
                <div
                    className="flex items-center gap-2 px-5 pb-3 flex-wrap"
                    onClick={e => e.stopPropagation()}
                >
                    <Filter className="size-3 text-muted-foreground shrink-0" />
                    <FilterDropdown
                        value={subId}
                        onValueChange={v => { setSubId(v); setRgFilter(''); setSevFilter(''); }}
                        options={subscriptions.map(s => ({ value: s.id, label: displaySubName(s) }))}
                        className="max-w-[140px]"
                    />
                    {availableRGs.length > 0 && (
                        <FilterDropdown
                            value={rgFilter}
                            onValueChange={v => setRgFilter(v)}
                            options={[{ value: '', label: 'All RGs' }, ...availableRGs.map(rg => ({ value: rg, label: rg }))]}
                            className="max-w-[120px]"
                        />
                    )}
                    <FilterDropdown
                        value={sevFilter}
                        onValueChange={v => setSevFilter(v as Severity | '')}
                        options={[
                            { value: '', label: 'All Severities' },
                            ...(Object.keys(SEVERITY_CONFIG) as Severity[]).map(s => ({ value: s, label: SEVERITY_CONFIG[s].label }))
                        ]}
                        className="max-w-[140px]"
                    />
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
                            <DefenderRecsList recs={filteredRecs} subscriptions={subscriptions} subId={subId} />
                        </div>
                    </div>
                </div>
            </div>
        </TooltipProvider>
    );
}

/* Paginated recommendations list — shows 25 at a time */
function DefenderRecsList({ recs }: { recs: DefenderRecs['recommendations']; subscriptions?: TenantSubscription[]; subId?: string }) {
    const { limit, showMore, hasMore } = useShowMore(25);
    const visible = recs.slice(0, limit);
    return (
        <>
            {visible.map((rec) => {
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
                                                <FolderOpen className="size-2.5" /> {rgSet.join(', ')}
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
                            {rec.affectedResources.map(r => (
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
            {hasMore(recs.length) && (
                <button
                    onClick={() => showMore()}
                    className="w-full mt-2 py-1.5 rounded-md text-xs font-medium text-primary hover:bg-primary/10 border border-primary/20 transition-all"
                >
                    Show {Math.min(recs.length - limit, 25)} more ({recs.length - limit} remaining)
                </button>
            )}
        </>
    );
}
