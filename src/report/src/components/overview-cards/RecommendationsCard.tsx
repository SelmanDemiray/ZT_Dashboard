import { useState, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell,
} from 'recharts';
import { ShieldAlert, Search, ChevronDown, ChevronUp, Zap, ExternalLink } from 'lucide-react';
import type { DefenderRecs, DefenderRecommendation, Severity, TenantSubscription, RunSnapshot } from '@/types/assessment';

interface Props {
    subscriptions: TenantSubscription[];
    subDataMap: Record<string, { latestSnapshot: RunSnapshot | null }>;
    defaultSubId: string;
}

const SEV_CONFIG: Record<Severity, { color: string; label: string; order: number }> = {
    critical: { color: '#ef4444', label: 'Critical', order: 0 },
    high: { color: '#f97316', label: 'High', order: 1 },
    medium: { color: '#eab308', label: 'Medium', order: 2 },
    low: { color: '#22c55e', label: 'Low', order: 3 },
};

export function RecommendationsCard({ subscriptions, subDataMap, defaultSubId }: Props) {
    const [subId, setSubId] = useState(defaultSubId || subscriptions[0]?.id || '');
    const [sevFilter, setSevFilter] = useState<Severity | ''>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const data: DefenderRecs | null = subDataMap[subId]?.latestSnapshot?.defenderRecs ?? null;
    const recs = data?.recommendations ?? [];

    /* Filtered recommendations */
    const filtered = useMemo(() => {
        let list = recs;
        if (sevFilter) list = list.filter(r => r.severity === sevFilter);
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            list = list.filter(r =>
                r.name.toLowerCase().includes(lower) ||
                r.description.toLowerCase().includes(lower) ||
                r.category.toLowerCase().includes(lower)
            );
        }
        return list.sort((a, b) => SEV_CONFIG[a.severity].order - SEV_CONFIG[b.severity].order);
    }, [recs, sevFilter, searchTerm]);

    /* Chart data — severity counts */
    const sevCounts = useMemo(() => {
        const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const r of recs) counts[r.severity]++;
        return (['critical', 'high', 'medium', 'low'] as Severity[]).map(s => ({
            name: SEV_CONFIG[s].label,
            value: counts[s],
            color: SEV_CONFIG[s].color,
            severity: s,
        }));
    }, [recs]);

    /* Stats */
    const attackPathCount = recs.filter(r => r.hasAttackPath).length;
    const totalAffected = recs.reduce((sum, r) => sum + r.resourceCount, 0);

    if (!data) {
        return (
            <div className="glass-card gradient-border p-6 flex items-center justify-center text-muted-foreground h-48">
                <ShieldAlert size={20} className="mr-2 opacity-50" />
                No recommendation data
            </div>
        );
    }

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <ShieldAlert size={18} className="text-orange-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Defender Recommendations</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={subId}
                            onChange={e => setSubId(e.target.value)}
                            className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            {subscriptions.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <select
                            value={sevFilter}
                            onChange={e => setSevFilter(e.target.value as Severity | '')}
                            className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            <option value="">All Severities</option>
                            {Object.entries(SEV_CONFIG).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="p-4 sm:p-5">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                    {/* Severity bar chart */}
                    <div className="lg:col-span-2">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">By Severity</p>
                        <div className="h-36">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={sevCounts} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} className="text-muted-foreground" width={28} />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: '0.5rem',
                                            border: '1px solid hsl(var(--border))',
                                            background: 'hsl(var(--popover))',
                                            color: 'hsl(var(--popover-foreground))',
                                            fontSize: '0.75rem',
                                        }}
                                    />
                                    <Bar
                                        dataKey="value"
                                        radius={[4, 4, 0, 0]}
                                        cursor="pointer"
                                        onClick={(entry: { severity: Severity }) => setSevFilter(sevFilter === entry.severity ? '' : entry.severity)}
                                    >
                                        {sevCounts.map((entry, i) => (
                                            <Cell
                                                key={i}
                                                fill={entry.color}
                                                opacity={sevFilter && sevFilter !== entry.severity ? 0.3 : 1}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        {/* Quick stats */}
                        <div className="flex flex-wrap gap-3 mt-3 justify-center">
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span className="font-bold text-foreground">{recs.length}</span> total
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span className="font-bold text-foreground">{totalAffected}</span> resources
                            </span>
                            {attackPathCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-red-400 font-medium">
                                    <Zap size={10} />{attackPathCount} attack paths
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Recommendations list */}
                    <div className="lg:col-span-3">
                        <div className="relative mb-2">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search recommendations…"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full h-7 rounded-md border border-input bg-background pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                        <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                            {filtered.length === 0 && (
                                <p className="text-center text-xs text-muted-foreground py-4">No recommendations match.</p>
                            )}
                            {filtered.map(rec => {
                                const isExpanded = expandedId === rec.id;
                                const sev = SEV_CONFIG[rec.severity];
                                return (
                                    <RecItem key={rec.id} rec={rec} sev={sev} isExpanded={isExpanded}
                                        onToggle={() => setExpandedId(isExpanded ? null : rec.id)} />
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function RecItem({ rec, sev, isExpanded, onToggle }: {
    rec: DefenderRecommendation;
    sev: { color: string; label: string };
    isExpanded: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="rounded-lg border border-border/50 bg-card/30 hover:bg-card/60 transition-all">
            <button onClick={onToggle} className="w-full p-2.5 flex items-center gap-2.5 text-left">
                <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: sev.color, boxShadow: `0 0 6px ${sev.color}50` }}
                />
                <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium truncate block">{rec.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate block">{rec.description}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {rec.hasAttackPath && (
                        <span className="flex items-center gap-0.5 text-[9px] font-medium text-red-400 bg-red-500/10 rounded-full px-1.5 py-0.5 border border-red-500/20">
                            <Zap size={8} /> Attack Path
                        </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{rec.resourceCount} res.</span>
                    {isExpanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                </div>
            </button>
            <div className="expand-panel" data-open={isExpanded ? 'true' : 'false'}>
                <div className="px-2.5 pb-2.5 border-t border-border/30 pt-2 space-y-2">
                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                            <span className="text-muted-foreground">Severity:</span>{' '}
                            <span className="font-medium" style={{ color: sev.color }}>{sev.label}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Category:</span>{' '}
                            <span className="font-medium">{rec.category}</span>
                        </div>
                    </div>
                    {/* Remediation */}
                    <div className="text-[10px]">
                        <span className="text-muted-foreground">Remediation:</span>{' '}
                        <span className="text-foreground">{rec.remediation}</span>
                    </div>
                    {/* Affected resources */}
                    <div className="space-y-0.5">
                        <p className="text-[10px] text-muted-foreground font-medium">Affected Resources:</p>
                        {rec.affectedResources.slice(0, 3).map(ar => (
                            <div key={ar.id} className="flex items-center gap-1.5 text-[10px]">
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: sev.color }} />
                                <span className="truncate">{ar.name}</span>
                                <span className="text-muted-foreground/50">·</span>
                                <span className="text-muted-foreground/70 truncate">{ar.type.split('/').pop()}</span>
                            </div>
                        ))}
                        {rec.affectedResources.length > 3 && (
                            <p className="text-[10px] text-muted-foreground italic">+{rec.affectedResources.length - 3} more</p>
                        )}
                    </div>
                    {/* Learn more */}
                    {rec.learnMoreUrl && (
                        <a
                            href={rec.learnMoreUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-sky-500 hover:text-sky-400 transition-colors"
                        >
                            <ExternalLink size={10} /> Learn more
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
