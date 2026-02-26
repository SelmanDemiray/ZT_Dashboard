import { useState, useMemo } from 'react';
import {
    PieChart,
    Pie,
    Cell,
    Tooltip as ReTooltip,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import {
    ShieldCheck, ChevronDown, ChevronUp, Filter,
    CheckCircle2, XCircle, MinusCircle, Layers, FolderOpen, Info,
} from 'lucide-react';
import type { PolicyCompliance, PolicyInitiative, PolicyResource } from '@/types/assessment';
import type { TenantSubscription } from '@/types/assessment';
import type { RunSnapshot } from '@/types/assessment';
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

const COLORS = {
    compliant: '#22c55e',
    nonCompliant: '#ef4444',
    exempt: '#8b5cf6',
};

function groupByRG(resources: PolicyResource[]) {
    const map: Record<string, PolicyResource[]> = {};
    resources.forEach((r) => {
        const rg = r.resourceGroup || 'Unknown';
        if (!map[rg]) map[rg] = [];
        map[rg].push(r);
    });
    return map;
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number; color: string } }> }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="rounded-xl border bg-background/95 backdrop-blur px-4 py-2.5 text-xs shadow-xl">
            <div className="flex items-center gap-2 font-semibold" style={{ color: d.color }}>
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                {d.name}
            </div>
            <div className="mt-1 text-muted-foreground">{d.value} resources</div>
        </div>
    );
};

export function ComplianceCard({ subscriptions, subDataMap, defaultSubId }: Props) {
    const [expanded, setExpanded] = useState(false);
    const [subId, setSubId] = useState(defaultSubId || subscriptions[0]?.id || '');
    const [rgFilter, setRgFilter] = useState('');
    const [hoveredInitId, setHoveredInitId] = useState<string | null>(null);

    const data: PolicyCompliance | null = subDataMap[subId]?.latestSnapshot?.policyCompliance ?? null;

    const sub = subscriptions.find(s => s.id === subId);
    const availableRGs = useMemo(() => sub?.resourceGroups ?? [], [sub]);

    const filteredInitiatives = useMemo(() => {
        if (!data) return [];
        if (!rgFilter) return data.initiatives;
        return data.initiatives
            .map((init) => ({
                ...init,
                resources: init.resources.filter(r => r.resourceGroup === rgFilter),
            }))
            .filter((init) => init.resources.length > 0 || !rgFilter);
    }, [data, rgFilter]);

    const stats = useMemo(() => {
        const totals = filteredInitiatives.reduce(
            (acc, init) => ({
                compliant: acc.compliant + init.compliantCount,
                nonCompliant: acc.nonCompliant + init.nonCompliantCount,
                exempt: acc.exempt + init.exemptCount,
                totalPolicies: acc.totalPolicies + init.totalPolicies,
            }),
            { compliant: 0, nonCompliant: 0, exempt: 0, totalPolicies: 0 },
        );
        const total = totals.compliant + totals.nonCompliant + totals.exempt;
        const pct = total > 0 ? Math.round((totals.compliant / total) * 100) : 0;
        return { ...totals, total, pct };
    }, [filteredInitiatives]);

    const pieData = [
        { name: 'Compliant', value: stats.compliant, color: COLORS.compliant },
        { name: 'Non-Compliant', value: stats.nonCompliant, color: COLORS.nonCompliant },
        { name: 'Exempt', value: stats.exempt, color: COLORS.exempt },
    ].filter(d => d.value > 0);

    const isHealthy = stats.pct >= 80;
    const isWarning = stats.pct >= 50 && stats.pct < 80;

    const accentColor = isHealthy ? '#22c55e' : isWarning ? '#eab308' : '#ef4444';
    const accentBg = isHealthy ? 'bg-emerald-500/10' : isWarning ? 'bg-yellow-500/10' : 'bg-red-500/10';

    if (!data) {
        return (
            <TooltipProvider>
                <div className="glass-card gradient-border scan-line p-6 flex flex-col items-center justify-center min-h-[300px] gap-3">
                    <ShieldCheck className="size-10 text-muted-foreground/40" />
                    {/* On-card filter even in empty state */}
                    <div className="flex items-center gap-2 mt-2">
                        <Filter className="size-3.5 text-muted-foreground" />
                        <select
                            value={subId}
                            onChange={e => { setSubId(e.target.value); setRgFilter(''); }}
                            onClick={e => e.stopPropagation()}
                            className="h-7 rounded-lg border bg-background/80 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            {subscriptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <span className="text-sm text-muted-foreground">No policy compliance data</span>
                </div>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider delayDuration={150}>
            <div
                className={`glass-card gradient-border scan-line cursor-pointer ${!isHealthy ? 'glow-warning' : ''}`}
                onClick={() => setExpanded(v => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setExpanded(v => !v)}
            >
                {/* ─── Header ─── */}
                <div className="flex items-start justify-between px-5 pt-5 pb-3 gap-2">
                    <div className="flex items-center gap-2.5">
                        <div className={`p-2 rounded-lg ${accentBg} ring-1 ring-inset`} style={{ boxShadow: `inset 0 0 0 1px ${accentColor}30` }}>
                            <ShieldCheck className="size-5" style={{ color: accentColor }} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground leading-none">
                                Policy Compliance
                            </h3>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                {rgFilter ? `RG: ${rgFilter}` : 'All resource groups'} · {filteredInitiatives.length} initiatives
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground shrink-0">
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
                    <select
                        value={subId}
                        onChange={e => { setSubId(e.target.value); setRgFilter(''); }}
                        className="h-7 max-w-[160px] rounded-lg border bg-background/80 px-2 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-ring truncate"
                        title={sub?.name}
                    >
                        {subscriptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {availableRGs.length > 0 && (
                        <select
                            value={rgFilter}
                            onChange={e => setRgFilter(e.target.value)}
                            className="h-7 max-w-[150px] rounded-lg border bg-background/80 px-2 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            <option value="">All RGs</option>
                            {availableRGs.map(rg => <option key={rg} value={rg}>{rg}</option>)}
                        </select>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={e => e.stopPropagation()}
                                className="ml-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <Info className="size-3.5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                            Shows Azure Policy compliance across all policy set initiatives. Filters cascade: pick a subscription, then a resource group.
                        </TooltipContent>
                    </Tooltip>
                </div>

                {/* ─── Donut + stats ─── */}
                <div className="flex items-center gap-5 px-5 pb-5">
                    <div className="relative w-32 h-32 shrink-0">
                        <ChartContainer
                            config={{
                                compliant: { label: 'Compliant', color: COLORS.compliant },
                                nonCompliant: { label: 'Non-Compliant', color: COLORS.nonCompliant },
                                exempt: { label: 'Exempt', color: COLORS.exempt },
                            }}
                            className="w-full h-full"
                        >
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    innerRadius={38}
                                    outerRadius={58}
                                    paddingAngle={3}
                                    dataKey="value"
                                    stroke="none"
                                    animationDuration={800}
                                    animationEasing="ease-out"
                                >
                                    {pieData.map((entry) => (
                                        <Cell key={entry.name} fill={entry.color} />
                                    ))}
                                </Pie>
                                <ReTooltip content={<CustomTooltip />} />
                            </PieChart>
                        </ChartContainer>
                        {/* centre label */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="stat-glow text-2xl font-bold" style={{ color: accentColor }}>
                                {stats.pct}%
                            </span>
                            <span className="text-[9px] text-muted-foreground leading-none mt-0.5">compliant</span>
                        </div>
                    </div>

                    <div className="flex-1 space-y-2.5">
                        {/* Big number */}
                        <div>
                            <div className="text-3xl font-bold tracking-tight tabular-nums" style={{ color: accentColor }}>
                                {stats.compliant.toLocaleString()}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                of {stats.total.toLocaleString()} resources compliant
                            </div>
                        </div>

                        {/* Mini legend */}
                        <div className="space-y-1.5">
                            {[
                                { label: 'Compliant', val: stats.compliant, color: COLORS.compliant, icon: CheckCircle2 },
                                { label: 'Non-Compliant', val: stats.nonCompliant, color: COLORS.nonCompliant, icon: XCircle },
                                { label: 'Exempt', val: stats.exempt, color: COLORS.exempt, icon: MinusCircle },
                            ].map(({ label, val, color, icon: Icon }) => {
                                const pct = stats.total > 0 ? (val / stats.total) * 100 : 0;
                                return (
                                    <Tooltip key={label}>
                                        <TooltipTrigger asChild>
                                            <div className="flex items-center gap-2 group">
                                                <Icon className="size-3 shrink-0" style={{ color }} />
                                                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-700 ease-out"
                                                        style={{ width: `${pct}%`, background: color }}
                                                    />
                                                </div>
                                                <span className="text-[11px] tabular-nums font-medium w-8 text-right" style={{ color }}>
                                                    {val}
                                                </span>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="text-xs">
                                            <span className="font-semibold">{label}</span>: {val} resources ({Math.round(pct)}%)
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* ─── Expand panel: initiative breakdown ─── */}
                <div className="expand-panel" data-open={expanded}>
                    <div>
                        <div className="border-t px-5 py-4 space-y-4 max-h-72 overflow-y-auto">
                            <div className="flex items-center gap-2">
                                <Layers className="size-3.5 text-muted-foreground" />
                                <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                                    Initiative Breakdown
                                </h4>
                            </div>

                            {filteredInitiatives.map((init: PolicyInitiative) => {
                                const total = init.compliantCount + init.nonCompliantCount + init.exemptCount;
                                const pct = total > 0 ? Math.round((init.compliantCount / total) * 100) : 0;
                                const rgMap = groupByRG(init.resources);
                                const isHovered = hoveredInitId === init.id;

                                return (
                                    <Tooltip key={init.id}>
                                        <TooltipTrigger asChild>
                                            <div
                                                className="space-y-1.5 rounded-lg p-2.5 -mx-2 hover:bg-muted/50 transition-colors cursor-default"
                                                onMouseEnter={() => setHoveredInitId(init.id)}
                                                onMouseLeave={() => setHoveredInitId(null)}
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <div className="flex justify-between items-center text-sm">
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                                                            style={{
                                                                background: init.type === 'builtin' ? '#3b82f620' : '#8b5cf620',
                                                                color: init.type === 'builtin' ? '#3b82f6' : '#8b5cf6',
                                                            }}
                                                        >
                                                            {init.type}
                                                        </span>
                                                        <span className="font-medium truncate max-w-[160px]">{init.name}</span>
                                                    </div>
                                                    <span
                                                        className="shrink-0 tabular-nums font-semibold text-sm ml-2"
                                                        style={{ color: pct >= 80 ? COLORS.compliant : pct >= 50 ? '#eab308' : COLORS.nonCompliant }}
                                                    >
                                                        {pct}%
                                                    </span>
                                                </div>

                                                {/* Progress bar */}
                                                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-700"
                                                        style={{
                                                            width: `${pct}%`,
                                                            background: `linear-gradient(90deg, ${pct >= 80 ? COLORS.compliant : pct >= 50 ? '#eab308' : COLORS.nonCompliant}, ${accentColor}88)`,
                                                        }}
                                                    />
                                                </div>

                                                {/* Counts */}
                                                <div className="flex gap-4 text-[11px] text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <CheckCircle2 className="size-3 text-emerald-500" /> {init.compliantCount}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <XCircle className="size-3 text-red-500" /> {init.nonCompliantCount}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <MinusCircle className="size-3 text-violet-500" /> {init.exemptCount}
                                                    </span>
                                                    <span className="ml-auto flex items-center gap-1 text-[10px]">
                                                        <FolderOpen className="size-3" /> {Object.keys(rgMap).length} RGs
                                                    </span>
                                                </div>

                                                {/* RG breakdown when hovered */}
                                                {isHovered && Object.keys(rgMap).length > 0 && (
                                                    <div className="mt-1.5 grid grid-cols-2 gap-1 pl-1">
                                                        {Object.entries(rgMap).slice(0, 6).map(([rg, resources]) => {
                                                            const compliantInRG = resources.filter(r => r.state === 'Compliant').length;
                                                            return (
                                                                <div key={rg} className="flex items-center justify-between text-[10px] bg-background/60 rounded px-1.5 py-0.5">
                                                                    <span className="truncate max-w-[80px] text-muted-foreground">{rg}</span>
                                                                    <span className="shrink-0 font-medium" style={{ color: compliantInRG === resources.length ? COLORS.compliant : COLORS.nonCompliant }}>
                                                                        {compliantInRG}/{resources.length}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="max-w-[260px] text-xs space-y-1">
                                            <p className="font-semibold">{init.name}</p>
                                            <p className="text-muted-foreground">{init.totalPolicies} policies · {init.type} · {Object.keys(rgMap).length} resource groups</p>
                                            <div className="flex gap-3 pt-0.5">
                                                <span className="text-emerald-500">✓ {init.compliantCount} compliant</span>
                                                <span className="text-red-500">✗ {init.nonCompliantCount} non-compliant</span>
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </TooltipProvider>
    );
}
