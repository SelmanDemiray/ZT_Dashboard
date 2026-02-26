import { useState, useMemo } from 'react';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { ShieldCheck, Filter, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, XCircle, FileWarning } from 'lucide-react';
import type { PolicyCompliance, PolicyInitiative, TenantSubscription, RunSnapshot } from '@/types/assessment';

interface Props {
    subscriptions: TenantSubscription[];
    subDataMap: Record<string, { latestSnapshot: RunSnapshot | null }>;
    defaultSubId: string;
}

const STATUS_COLORS = {
    Compliant: '#22c55e',
    NonCompliant: '#ef4444',
    Exempt: '#eab308',
};

const TYPE_LABELS: Record<string, string> = {
    builtin: 'Built-in',
    custom: 'Custom',
};

export function ComplianceDeepDiveCard({ subscriptions, subDataMap, defaultSubId }: Props) {
    const [subId, setSubId] = useState(defaultSubId || subscriptions[0]?.id || '');
    const [typeFilter, setTypeFilter] = useState<'all' | 'builtin' | 'custom'>('all');
    const [expandedInit, setExpandedInit] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const data: PolicyCompliance | null = subDataMap[subId]?.latestSnapshot?.policyCompliance ?? null;
    const initiatives = data?.initiatives ?? [];

    /* Filtered initiatives */
    const filtered = useMemo(() => {
        let list = initiatives;
        if (typeFilter !== 'all') list = list.filter(i => i.type === typeFilter);
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            list = list.filter(i => i.name.toLowerCase().includes(lower));
        }
        return list;
    }, [initiatives, typeFilter, searchTerm]);

    /* Aggregated totals */
    const totals = useMemo(() => {
        const t = { compliant: 0, nonCompliant: 0, exempt: 0, total: 0 };
        for (const init of filtered) {
            t.compliant += init.compliantCount;
            t.nonCompliant += init.nonCompliantCount;
            t.exempt += init.exemptCount;
            t.total += init.totalPolicies;
        }
        return t;
    }, [filtered]);

    const compliancePct = totals.total > 0 ? Math.round((totals.compliant / totals.total) * 100) : 0;

    const pieData = [
        { name: 'Compliant', value: totals.compliant },
        { name: 'NonCompliant', value: totals.nonCompliant },
        { name: 'Exempt', value: totals.exempt },
    ].filter(d => d.value > 0);

    /* Bar data — per-initiative compliance */
    const barData = useMemo(() =>
        filtered.map(init => ({
            name: init.name.length > 22 ? init.name.slice(0, 22) + '…' : init.name,
            fullName: init.name,
            compliant: init.compliantCount,
            nonCompliant: init.nonCompliantCount,
            exempt: init.exemptCount,
        })), [filtered]);

    /* Resource breakdown for expanded initiative */
    const getResourceBreakdown = (init: PolicyInitiative) => {
        const groups: Record<string, { compliant: number; nonCompliant: number; total: number }> = {};
        for (const r of init.resources) {
            const rg = r.resourceGroup || 'Ungrouped';
            if (!groups[rg]) groups[rg] = { compliant: 0, nonCompliant: 0, total: 0 };
            groups[rg].total++;
            if (r.state === 'Compliant') groups[rg].compliant++;
            else groups[rg].nonCompliant++;
        }
        return Object.entries(groups).map(([name, v]) => ({ name, ...v }));
    };

    if (!data) {
        return (
            <div className="glass-card gradient-border p-6 flex items-center justify-center text-muted-foreground h-60">
                <ShieldCheck size={20} className="mr-2 opacity-50" />
                No compliance data available
            </div>
        );
    }

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <ShieldCheck size={18} className="text-emerald-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Compliance Deep Dive</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Subscription filter */}
                        <select
                            value={subId}
                            onChange={e => setSubId(e.target.value)}
                            className="h-7 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            {subscriptions.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        {/* Type filter */}
                        <select
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value as 'all' | 'builtin' | 'custom')}
                            className="h-7 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            <option value="all">All Types</option>
                            <option value="builtin">Built-in</option>
                            <option value="custom">Custom</option>
                        </select>
                        {/* Search */}
                        <div className="relative">
                            <Filter size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search initiatives…"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="h-7 w-36 sm:w-44 rounded-md border border-input bg-background pl-6 pr-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Content grid */}
            <div className="p-4 sm:p-5">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {/* Left: Donut + quick stats */}
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-full max-w-[200px] aspect-square">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={pieData}
                                        dataKey="value"
                                        innerRadius="60%"
                                        outerRadius="90%"
                                        paddingAngle={3}
                                        stroke="none"
                                    >
                                        {pieData.map(d => (
                                            <Cell
                                                key={d.name}
                                                fill={STATUS_COLORS[d.name as keyof typeof STATUS_COLORS]}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value: number, name: string) => [value, name]}
                                        contentStyle={{
                                            borderRadius: '0.5rem',
                                            border: '1px solid hsl(var(--border))',
                                            background: 'hsl(var(--popover))',
                                            color: 'hsl(var(--popover-foreground))',
                                            fontSize: '0.75rem',
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        {/* Center stat */}
                        <div className="text-center -mt-4">
                            <p className="stat-glow text-3xl font-bold" style={{ color: compliancePct >= 80 ? '#22c55e' : compliancePct >= 60 ? '#eab308' : '#ef4444' }}>
                                {compliancePct}%
                            </p>
                            <p className="text-xs text-muted-foreground">Overall Compliance</p>
                        </div>
                        {/* Quick stat chips */}
                        <div className="flex flex-wrap justify-center gap-2">
                            <StatChip icon={<CheckCircle2 size={12} />} value={totals.compliant} label="Compliant" color="#22c55e" />
                            <StatChip icon={<XCircle size={12} />} value={totals.nonCompliant} label="Non-Compliant" color="#ef4444" />
                            <StatChip icon={<FileWarning size={12} />} value={totals.exempt} label="Exempt" color="#eab308" />
                        </div>
                    </div>

                    {/* Center: Stacked bar chart */}
                    <div className="lg:col-span-2">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">Policy Sets Breakdown</p>
                        <div className="h-48 sm:h-52 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={barData} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                                    <XAxis type="number" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                                    <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 10 }} className="text-muted-foreground" />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: '0.5rem',
                                            border: '1px solid hsl(var(--border))',
                                            background: 'hsl(var(--popover))',
                                            color: 'hsl(var(--popover-foreground))',
                                            fontSize: '0.75rem',
                                        }}
                                    />
                                    <Bar dataKey="compliant" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} name="Compliant" />
                                    <Bar dataKey="nonCompliant" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} name="Non-Compliant" />
                                    <Bar dataKey="exempt" stackId="a" fill="#eab308" radius={[0, 4, 4, 0]} name="Exempt" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Initiative list */}
                <div className="mt-5 space-y-2 max-h-[280px] overflow-y-auto pr-1 scrollbar-thin">
                    {filtered.length === 0 && (
                        <p className="text-center text-xs text-muted-foreground py-4">No initiatives match the current filters.</p>
                    )}
                    {filtered.map(init => {
                        const pct = init.totalPolicies > 0 ? Math.round((init.compliantCount / init.totalPolicies) * 100) : 0;
                        const isExpanded = expandedInit === init.id;
                        const rgBreakdown = isExpanded ? getResourceBreakdown(init) : [];
                        const failingResources = init.resources.filter(r => r.state !== 'Compliant');
                        return (
                            <div
                                key={init.id}
                                className="rounded-lg border border-border/50 bg-card/40 transition-all hover:bg-card/70"
                            >
                                <button
                                    onClick={() => setExpandedInit(isExpanded ? null : init.id)}
                                    className="w-full flex items-center gap-3 p-3 text-left"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium truncate">{init.name}</span>
                                            <span
                                                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
                                                style={{
                                                    borderColor: init.type === 'custom' ? '#a78bfa40' : '#60a5fa40',
                                                    background: init.type === 'custom' ? '#a78bfa12' : '#60a5fa12',
                                                    color: init.type === 'custom' ? '#a78bfa' : '#60a5fa',
                                                }}
                                            >
                                                {TYPE_LABELS[init.type]}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex items-center gap-2">
                                            <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden max-w-[200px]">
                                                <div
                                                    className="h-full rounded-full transition-all duration-500"
                                                    style={{
                                                        width: `${pct}%`,
                                                        background: pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444',
                                                    }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-muted-foreground font-medium">{pct}%</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span className="hidden sm:inline">
                                            {init.compliantCount}/{init.totalPolicies} policies
                                        </span>
                                        {failingResources.length > 0 && (
                                            <span className="flex items-center gap-1 text-red-400">
                                                <AlertTriangle size={10} />{failingResources.length}
                                            </span>
                                        )}
                                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </div>
                                </button>

                                {/* Expanded detail */}
                                <div className="expand-panel" data-open={isExpanded ? 'true' : 'false'}>
                                    <div className="px-3 pb-3">
                                        <div className="border-t border-border/30 pt-3">
                                            {/* Resource group breakdown */}
                                            {rgBreakdown.length > 0 && (
                                                <div className="space-y-1.5 mb-3">
                                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Resource Groups</p>
                                                    {rgBreakdown.map(rg => (
                                                        <div key={rg.name} className="flex items-center gap-2 text-xs">
                                                            <span className="w-24 truncate text-muted-foreground">{rg.name}</span>
                                                            <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                                                                <div className="flex h-full">
                                                                    <div className="h-full bg-green-500" style={{ width: `${(rg.compliant / rg.total) * 100}%` }} />
                                                                    <div className="h-full bg-red-500" style={{ width: `${(rg.nonCompliant / rg.total) * 100}%` }} />
                                                                </div>
                                                            </div>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {rg.compliant}/{rg.total}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Failing policies */}
                                            {failingResources.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Failing Policies</p>
                                                    {failingResources.slice(0, 5).map(r => (
                                                        <div key={r.resourceId} className="flex items-start gap-2 text-xs py-1">
                                                            <XCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                                                            <div className="min-w-0">
                                                                <span className="font-medium truncate block">{r.resourceName}</span>
                                                                <span className="text-muted-foreground text-[10px]">{r.resourceGroup}</span>
                                                                {r.failingPolicies.map(fp => (
                                                                    <span key={fp.id} className="block text-red-400/80 text-[10px]">
                                                                        → {fp.name}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {failingResources.length > 5 && (
                                                        <p className="text-[10px] text-muted-foreground italic pl-5">
                                                            +{failingResources.length - 5} more resources…
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/* Tiny stat chip */
function StatChip({ icon, value, label, color }: { icon: React.ReactNode; value: number; label: string; color: string }) {
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border"
            style={{ borderColor: `${color}30`, color, background: `${color}08` }}
        >
            {icon} {value} {label}
        </span>
    );
}
