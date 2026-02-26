import { useState, useMemo } from 'react';
import { BookOpen, Search, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, XCircle, Tag } from 'lucide-react';
import type { PolicyCompliance, PolicyInitiative, PolicyResource, TenantSubscription, RunSnapshot } from '@/types/assessment';

interface Props {
    subscriptions: TenantSubscription[];
    subDataMap: Record<string, { latestSnapshot: RunSnapshot | null }>;
    defaultSubId: string;
}

type ViewMode = 'initiatives' | 'policies' | 'resources';

export function PolicyExplorerCard({ subscriptions, subDataMap, defaultSubId }: Props) {
    const [subId, setSubId] = useState(defaultSubId || subscriptions[0]?.id || '');
    const [viewMode, setViewMode] = useState<ViewMode>('initiatives');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [rgFilter, setRgFilter] = useState('');

    const data: PolicyCompliance | null = subDataMap[subId]?.latestSnapshot?.policyCompliance ?? null;
    const initiatives = data?.initiatives ?? [];

    /* Extract all unique resource groups */
    const resourceGroups = useMemo(() => {
        const set = new Set<string>();
        for (const init of initiatives) {
            for (const r of init.resources) {
                if (r.resourceGroup) set.add(r.resourceGroup);
            }
        }
        return Array.from(set).sort();
    }, [initiatives]);

    /* Extract all unique failing policies across all resources */
    const allPolicies = useMemo(() => {
        const map = new Map<string, { id: string; name: string; description: string; initName: string; count: number; failingResources: PolicyResource[] }>();
        for (const init of initiatives) {
            for (const r of init.resources) {
                for (const fp of r.failingPolicies) {
                    const existing = map.get(fp.id);
                    if (existing) {
                        existing.count++;
                        existing.failingResources.push(r);
                    } else {
                        map.set(fp.id, { ...fp, initName: init.name, count: 1, failingResources: [r] });
                    }
                }
            }
        }
        return Array.from(map.values());
    }, [initiatives]);

    /* Filtered resources */
    const allResources = useMemo(() => {
        const resources: (PolicyResource & { initName: string; initType: string })[] = [];
        for (const init of initiatives) {
            for (const r of init.resources) {
                if (rgFilter && r.resourceGroup !== rgFilter) continue;
                resources.push({ ...r, initName: init.name, initType: init.type });
            }
        }
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            return resources.filter(r =>
                r.resourceName.toLowerCase().includes(lower) ||
                r.resourceType.toLowerCase().includes(lower) ||
                r.resourceGroup.toLowerCase().includes(lower)
            );
        }
        return resources;
    }, [initiatives, searchTerm, rgFilter]);

    /* Totals for the top strip */
    const totalInitiatives = initiatives.length;
    const totalCustom = initiatives.filter(i => i.type === 'custom').length;
    const totalBuiltin = initiatives.filter(i => i.type === 'builtin').length;
    const totalResources = allResources.length;
    const nonCompliantResources = allResources.filter(r => r.state !== 'Compliant').length;

    if (!data) {
        return (
            <div className="glass-card gradient-border p-6 flex items-center justify-center text-muted-foreground h-48">
                <BookOpen size={20} className="mr-2 opacity-50" />
                No policy data available
            </div>
        );
    }

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <BookOpen size={18} className="text-violet-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Policy Explorer</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={subId}
                            onChange={e => setSubId(e.target.value)}
                            className="h-7 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            {subscriptions.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <select
                            value={rgFilter}
                            onChange={e => setRgFilter(e.target.value)}
                            className="h-7 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            <option value="">All RGs</option>
                            {resourceGroups.map(rg => (
                                <option key={rg} value={rg}>{rg}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* View mode tabs */}
                <div className="flex gap-1 mt-3">
                    {(['initiatives', 'policies', 'resources'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => { setViewMode(mode); setExpandedId(null); }}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${viewMode === mode
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'text-muted-foreground hover:bg-muted/50'
                                }`}
                        >
                            {mode === 'initiatives' ? 'Policy Sets' : mode === 'policies' ? 'Failing Policies' : 'Resources'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Top stat strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-border/30">
                <MiniStat label="Policy Sets" value={totalInitiatives} />
                <MiniStat label="Built-in" value={totalBuiltin} color="#60a5fa" />
                <MiniStat label="Custom" value={totalCustom} color="#a78bfa" />
                <MiniStat label="Resources" value={totalResources} />
                <MiniStat label="Non-Compliant" value={nonCompliantResources} color="#ef4444" />
            </div>

            {/* Search */}
            <div className="p-3 border-b border-border/30">
                <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder={`Search ${viewMode}…`}
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full h-7 rounded-md border border-input bg-background pl-6 pr-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                </div>
            </div>

            {/* Content */}
            <div className="p-3 max-h-[320px] overflow-y-auto space-y-1.5">
                {viewMode === 'initiatives' && <InitiativesList
                    initiatives={initiatives}
                    searchTerm={searchTerm}
                    expandedId={expandedId}
                    setExpandedId={setExpandedId}
                />}
                {viewMode === 'policies' && <PoliciesList
                    policies={allPolicies}
                    searchTerm={searchTerm}
                    expandedId={expandedId}
                    setExpandedId={setExpandedId}
                />}
                {viewMode === 'resources' && <ResourcesList
                    resources={allResources}
                    searchTerm={searchTerm}
                />}
            </div>
        </div>
    );
}

/* ─── Sub-Components ──────────────────────────────────────────────── */

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
    return (
        <div className="bg-card/40 p-2 text-center">
            <p className="stat-glow text-lg font-bold" style={{ color: color ?? 'inherit' }}>{value}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
    );
}

function InitiativesList({ initiatives, searchTerm, expandedId, setExpandedId }: {
    initiatives: PolicyInitiative[];
    searchTerm: string;
    expandedId: string | null;
    setExpandedId: (id: string | null) => void;
}) {
    const filtered = useMemo(() => {
        if (!searchTerm) return initiatives;
        const lower = searchTerm.toLowerCase();
        return initiatives.filter(i => i.name.toLowerCase().includes(lower));
    }, [initiatives, searchTerm]);

    if (filtered.length === 0) {
        return <p className="text-center text-xs text-muted-foreground py-4">No policy sets found.</p>;
    }

    return (
        <>
            {filtered.map(init => {
                const pct = init.totalPolicies > 0 ? Math.round((init.compliantCount / init.totalPolicies) * 100) : 0;
                const isExpanded = expandedId === init.id;
                return (
                    <div key={init.id} className="rounded-lg border border-border/50 bg-card/30 hover:bg-card/60 transition-all">
                        <button
                            onClick={() => setExpandedId(isExpanded ? null : init.id)}
                            className="w-full p-2.5 flex items-center gap-3 text-left"
                        >
                            <Tag size={14} className={init.type === 'custom' ? 'text-violet-400' : 'text-sky-400'} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium truncate">{init.name}</span>
                                    <span className="flex-shrink-0 rounded px-1 py-px text-[9px] font-medium"
                                        style={{
                                            background: init.type === 'custom' ? '#a78bfa18' : '#60a5fa18',
                                            color: init.type === 'custom' ? '#a78bfa' : '#60a5fa',
                                        }}
                                    >
                                        {init.type === 'custom' ? 'Custom' : 'Built-in'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="flex-1 h-1 rounded-full bg-muted/40 overflow-hidden max-w-[160px]">
                                        <div className="h-full rounded-full" style={{
                                            width: `${pct}%`,
                                            background: pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444',
                                        }} />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground">{init.compliantCount}/{init.totalPolicies}</span>
                                </div>
                            </div>
                            {isExpanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                        </button>
                        <div className="expand-panel" data-open={isExpanded ? 'true' : 'false'}>
                            <div className="px-2.5 pb-2.5 pt-0 border-t border-border/30">
                                <div className="grid grid-cols-3 gap-2 py-2 text-center">
                                    <div>
                                        <p className="text-xs font-bold text-green-500">{init.compliantCount}</p>
                                        <p className="text-[9px] text-muted-foreground">Compliant</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-red-400">{init.nonCompliantCount}</p>
                                        <p className="text-[9px] text-muted-foreground">Non-Compliant</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-yellow-500">{init.exemptCount}</p>
                                        <p className="text-[9px] text-muted-foreground">Exempt</p>
                                    </div>
                                </div>
                                {/* Resource listing */}
                                {init.resources.filter(r => r.state !== 'Compliant').slice(0, 4).map(r => (
                                    <div key={r.resourceId} className="flex items-center gap-1.5 text-[10px] py-0.5">
                                        <XCircle size={10} className="text-red-400 flex-shrink-0" />
                                        <span className="truncate text-muted-foreground">{r.resourceName}</span>
                                        <span className="text-muted-foreground/50">·</span>
                                        <span className="truncate text-muted-foreground/70">{r.resourceGroup}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            })}
        </>
    );
}

function PoliciesList({ policies, searchTerm, expandedId, setExpandedId }: {
    policies: { id: string; name: string; description: string; initName: string; count: number; failingResources: PolicyResource[] }[];
    searchTerm: string;
    expandedId: string | null;
    setExpandedId: (id: string | null) => void;
}) {
    const filtered = useMemo(() => {
        if (!searchTerm) return policies;
        const lower = searchTerm.toLowerCase();
        return policies.filter(p => p.name.toLowerCase().includes(lower) || p.description.toLowerCase().includes(lower));
    }, [policies, searchTerm]);

    if (filtered.length === 0) {
        return <p className="text-center text-xs text-muted-foreground py-4">
            {policies.length === 0 ? 'All policies are passing — no failing policies found.' : 'No policies match the search.'}
        </p>;
    }

    return (
        <>
            {filtered.map(pol => {
                const isExpanded = expandedId === pol.id;
                return (
                    <div key={pol.id} className="rounded-lg border border-border/50 bg-card/30 hover:bg-card/60 transition-all">
                        <button
                            onClick={() => setExpandedId(isExpanded ? null : pol.id)}
                            className="w-full p-2.5 flex items-center gap-3 text-left"
                        >
                            <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium truncate block">{pol.name}</span>
                                <span className="text-[10px] text-muted-foreground truncate block">{pol.description}</span>
                            </div>
                            <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                {pol.count}
                            </span>
                            {isExpanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                        </button>
                        <div className="expand-panel" data-open={isExpanded ? 'true' : 'false'}>
                            <div className="px-2.5 pb-2.5 border-t border-border/30 pt-2">
                                <p className="text-[10px] text-muted-foreground mb-1">
                                    From: <span className="font-medium text-foreground">{pol.initName}</span>
                                </p>
                                {pol.failingResources.slice(0, 5).map(r => (
                                    <div key={r.resourceId} className="flex items-center gap-1.5 text-[10px] py-0.5">
                                        <XCircle size={10} className="text-red-400 flex-shrink-0" />
                                        <span className="truncate">{r.resourceName}</span>
                                        <span className="text-muted-foreground/50">·</span>
                                        <span className="truncate text-muted-foreground/70">{r.resourceGroup}</span>
                                    </div>
                                ))}
                                {pol.failingResources.length > 5 && (
                                    <p className="text-[10px] text-muted-foreground italic mt-1">
                                        +{pol.failingResources.length - 5} more…
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </>
    );
}

function ResourcesList({ resources, searchTerm }: {
    resources: (PolicyResource & { initName: string; initType: string })[];
    searchTerm: string;
}) {
    const filtered = useMemo(() => {
        if (!searchTerm) return resources;
        const lower = searchTerm.toLowerCase();
        return resources.filter(r =>
            r.resourceName.toLowerCase().includes(lower) ||
            r.resourceType.toLowerCase().includes(lower) ||
            r.resourceGroup.toLowerCase().includes(lower)
        );
    }, [resources, searchTerm]);

    if (filtered.length === 0) {
        return <p className="text-center text-xs text-muted-foreground py-4">No resources found.</p>;
    }

    return (
        <div className="space-y-0.5">
            {filtered.slice(0, 50).map(r => (
                <div key={r.resourceId} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/30 transition-all text-xs">
                    {r.state === 'Compliant'
                        ? <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                        : <XCircle size={13} className="text-red-400 flex-shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                        <span className="font-medium truncate block">{r.resourceName}</span>
                        <span className="text-[10px] text-muted-foreground truncate block">{r.resourceType}</span>
                    </div>
                    <span className="hidden sm:inline text-[10px] text-muted-foreground truncate max-w-[100px]">{r.resourceGroup}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{r.initName}</span>
                </div>
            ))}
            {filtered.length > 50 && (
                <p className="text-center text-xs text-muted-foreground py-2 italic">Showing 50 of {filtered.length} resources</p>
            )}
        </div>
    );
}
