import { useState, useMemo } from 'react';
import { Scale, ChevronDown, ChevronUp, CheckCircle2, Clock, AlertTriangle, User, Calendar, Link2 } from 'lucide-react';
import type { Governance, GovernanceStatus, TenantSubscription, RunSnapshot } from '@/types/assessment';

interface Props {
    subscriptions: TenantSubscription[];
    subDataMap: Record<string, { latestSnapshot: RunSnapshot | null }>;
    defaultSubId: string;
}

const STATUS_CONFIG: Record<GovernanceStatus, { color: string; label: string; icon: typeof CheckCircle2 }> = {
    completed: { color: '#22c55e', label: 'Completed', icon: CheckCircle2 },
    inProgress: { color: '#60a5fa', label: 'In Progress', icon: Clock },
    notStarted: { color: '#94a3b8', label: 'Not Started', icon: Clock },
    overdue: { color: '#ef4444', label: 'Overdue', icon: AlertTriangle },
};

export function GovernanceRulesCard({ subscriptions, subDataMap, defaultSubId }: Props) {
    const [subId, setSubId] = useState(defaultSubId || subscriptions[0]?.id || '');
    const [statusFilter, setStatusFilter] = useState<GovernanceStatus | ''>('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const data: Governance | null = subDataMap[subId]?.latestSnapshot?.governance ?? null;
    const rules = data?.rules ?? [];

    const filtered = useMemo(() => {
        if (!statusFilter) return rules;
        return rules.filter(r => r.status === statusFilter);
    }, [rules, statusFilter]);

    /* Summary stats */
    const stats = useMemo(() => {
        const s = { completed: 0, inProgress: 0, notStarted: 0, overdue: 0, avgCompletion: 0 };
        if (rules.length === 0) return s;
        let totalCompletion = 0;
        for (const r of rules) {
            s[r.status]++;
            totalCompletion += r.completionPercentage;
        }
        s.avgCompletion = Math.round(totalCompletion / rules.length);
        return s;
    }, [rules]);

    /* Progress ring for average */
    const ringRadius = 34;
    const ringStroke = 5;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference - (stats.avgCompletion / 100) * ringCircumference;
    const ringColor = stats.avgCompletion >= 80 ? '#22c55e' : stats.avgCompletion >= 50 ? '#eab308' : '#ef4444';

    if (!data) {
        return (
            <div className="glass-card gradient-border p-6 flex items-center justify-center text-muted-foreground h-48">
                <Scale size={20} className="mr-2 opacity-50" />
                No governance data available
            </div>
        );
    }

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Scale size={18} className="text-sky-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Governance Rules</h3>
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
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value as GovernanceStatus | '')}
                            className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            <option value="">All Statuses</option>
                            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="p-4 sm:p-5">
                <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-5">
                    {/* Left: Progress ring + status chips */}
                    <div className="flex flex-col items-center gap-3">
                        <svg width={90} height={90} viewBox="0 0 90 90" className="drop-shadow-sm">
                            <circle cx="45" cy="45" r={ringRadius} fill="none" stroke="currentColor"
                                strokeWidth={ringStroke} className="text-muted/30" />
                            <circle cx="45" cy="45" r={ringRadius} fill="none" stroke={ringColor}
                                strokeWidth={ringStroke} strokeLinecap="round"
                                strokeDasharray={ringCircumference} strokeDashoffset={ringOffset}
                                className="progress-ring-animated"
                                style={{ transform: 'rotate(-90deg)', transformOrigin: '45px 45px', filter: `drop-shadow(0 0 4px ${ringColor}40)` }}
                            />
                            <text x="45" y="48" textAnchor="middle" className="fill-foreground font-bold" style={{ fontSize: '1.1rem' }}>
                                {stats.avgCompletion}%
                            </text>
                        </svg>
                        <p className="text-[10px] text-muted-foreground -mt-1">Avg. Completion</p>

                        {/* Status chips */}
                        <div className="flex flex-wrap gap-1.5 justify-center">
                            {((['completed', 'inProgress', 'notStarted', 'overdue'] as GovernanceStatus[]).map(status => {
                                const cfg = STATUS_CONFIG[status];
                                const count = stats[status];
                                const isActive = statusFilter === status;
                                return (
                                    <button
                                        key={status}
                                        onClick={() => setStatusFilter(isActive ? '' : status)}
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all ${isActive ? 'ring-1 ring-offset-1 ring-offset-background' : ''
                                            }`}
                                        style={{
                                            borderColor: `${cfg.color}40`,
                                            background: `${cfg.color}${isActive ? '20' : '08'}`,
                                            color: cfg.color,
                                            ...(isActive ? { ringColor: cfg.color } : {}),
                                        }}
                                    >
                                        {count} {cfg.label}
                                    </button>
                                );
                            }))}
                        </div>
                    </div>

                    {/* Right: Rules list */}
                    <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                        {filtered.length === 0 && (
                            <p className="text-center text-xs text-muted-foreground py-4">No rules match the current filter.</p>
                        )}
                        {filtered.map(rule => {
                            const cfg = STATUS_CONFIG[rule.status];
                            const StatusIcon = cfg.icon;
                            const isExpanded = expandedId === rule.id;
                            return (
                                <div key={rule.id} className="rounded-lg border border-border/50 bg-card/30 hover:bg-card/60 transition-all">
                                    <button
                                        onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                                        className="w-full p-2.5 flex items-center gap-2.5 text-left"
                                    >
                                        <StatusIcon size={14} style={{ color: cfg.color }} className="flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <span className="text-xs font-medium truncate block">{rule.name}</span>
                                            <div className="flex items-center gap-2 mt-1">
                                                <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden max-w-[140px]">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-500"
                                                        style={{
                                                            width: `${rule.completionPercentage}%`,
                                                            background: cfg.color,
                                                            boxShadow: `0 0 4px ${cfg.color}40`,
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-[10px] text-muted-foreground font-medium">{rule.completionPercentage}%</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0 text-muted-foreground">
                                            {rule.status === 'overdue' && (
                                                <span className="text-[9px] font-medium text-red-400 bg-red-500/10 rounded-full px-1.5 py-0.5 border border-red-500/20">
                                                    Overdue
                                                </span>
                                            )}
                                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                        </div>
                                    </button>
                                    <div className="expand-panel" data-open={isExpanded ? 'true' : 'false'}>
                                        <div className="px-2.5 pb-2.5 border-t border-border/30 pt-2 space-y-2">
                                            <p className="text-[10px] text-muted-foreground">{rule.description}</p>
                                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                                                <div className="flex items-center gap-1">
                                                    <User size={10} className="text-muted-foreground" />
                                                    <span className="text-muted-foreground">Owner:</span>{' '}
                                                    <span className="font-medium truncate">{rule.owner}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Calendar size={10} className="text-muted-foreground" />
                                                    <span className="text-muted-foreground">Due:</span>{' '}
                                                    <span className="font-medium">{rule.dueDate}</span>
                                                </div>
                                            </div>
                                            {/* Linked IDs */}
                                            <div className="flex flex-wrap gap-2 text-[10px]">
                                                {rule.linkedRecommendationIds.length > 0 && (
                                                    <span className="flex items-center gap-1 text-muted-foreground">
                                                        <Link2 size={9} />
                                                        {rule.linkedRecommendationIds.length} linked rec{rule.linkedRecommendationIds.length > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                                {rule.linkedPolicyIds.length > 0 && (
                                                    <span className="flex items-center gap-1 text-muted-foreground">
                                                        <Link2 size={9} />
                                                        {rule.linkedPolicyIds.length} linked polic{rule.linkedPolicyIds.length > 1 ? 'ies' : 'y'}
                                                    </span>
                                                )}
                                            </div>
                                            {/* Completion criteria */}
                                            {rule.completionCriteria.length > 0 && (
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-medium text-muted-foreground">Criteria:</p>
                                                    {rule.completionCriteria.map((c, i) => (
                                                        <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                                            {c.completed
                                                                ? <CheckCircle2 size={10} className="text-green-500" />
                                                                : <div className="w-2.5 h-2.5 rounded-full border border-muted-foreground/40" />
                                                            }
                                                            <span className={c.completed ? 'line-through text-muted-foreground/50' : ''}>
                                                                {c.description}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
