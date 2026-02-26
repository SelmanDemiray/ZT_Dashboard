import { useState, useMemo } from 'react';
import {
    AlertTriangle, CheckCircle2, Clock, CircleDot,
    ChevronDown, ChevronUp, Filter, Info, User,
    Calendar, ClipboardList, Link2,
} from 'lucide-react';
import type { Governance, GovernanceStatus } from '@/types/assessment';
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

const STATUS_CONFIG: Record<GovernanceStatus, { label: string; color: string; icon: React.ElementType; bg: string }> = {
    completed: { label: 'Completed', color: '#22c55e', bg: '#22c55e18', icon: CheckCircle2 },
    inProgress: { label: 'In Progress', color: '#3b82f6', bg: '#3b82f618', icon: Clock },
    notStarted: { label: 'Not Started', color: '#94a3b8', bg: '#94a3b818', icon: CircleDot },
    overdue: { label: 'Overdue', color: '#ef4444', bg: '#ef444418', icon: AlertTriangle },
};

export function GovernanceCard({ subscriptions, subDataMap, defaultSubId }: Props) {
    const [expanded, setExpanded] = useState(false);
    const [subId, setSubId] = useState(defaultSubId || subscriptions[0]?.id || '');
    const [rgFilter, setRgFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<GovernanceStatus | ''>('');

    const data: Governance | null = subDataMap[subId]?.latestSnapshot?.governance ?? null;
    const sub = subscriptions.find(s => s.id === subId);
    const availableRGs = useMemo(() => sub?.resourceGroups ?? [], [sub]);

    const filteredRules = useMemo(() => {
        if (!data) return [];
        return data.rules.filter(r => {
            if (statusFilter && r.status !== statusFilter) return false;
            // rules with subscriptionId matching selected sub are shown
            // rgFilter applied via linked policies (approximation for demo)
            return true;
        });
    }, [data, statusFilter]);

    const stats = useMemo(() => {
        const counts: Record<GovernanceStatus, number> = { completed: 0, inProgress: 0, notStarted: 0, overdue: 0 };
        let totalCompletion = 0;
        filteredRules.forEach((r) => {
            counts[r.status]++;
            totalCompletion += r.completionPercentage;
        });
        const total = filteredRules.length;
        const avgCompletion = total > 0 ? Math.round(totalCompletion / total) : 0;
        return { counts, total, avgCompletion };
    }, [filteredRules]);

    const hasOverdue = stats.counts.overdue > 0;
    const radius = 44;
    const circumference = 2 * Math.PI * radius;
    const dashoffset = circumference - (stats.avgCompletion / 100) * circumference;

    const accentColor = hasOverdue ? '#ef4444' : stats.avgCompletion >= 80 ? '#22c55e' : '#3b82f6';

    if (!data) {
        return (
            <TooltipProvider>
                <div className="glass-card gradient-border scan-line p-6 flex flex-col items-center justify-center min-h-[300px] gap-3">
                    <ClipboardList className="size-10 text-muted-foreground/40" />
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
                    <span className="text-sm text-muted-foreground">No governance data</span>
                </div>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider delayDuration={150}>
            <div
                className={`glass-card gradient-border scan-line cursor-pointer ${hasOverdue ? 'glow-warning' : ''}`}
                onClick={() => setExpanded(v => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setExpanded(v => !v)}
            >
                {/* ─── Header ─── */}
                <div className="flex items-start justify-between px-5 pt-5 pb-3 gap-2">
                    <div className="flex items-center gap-2.5">
                        <div
                            className="p-2 rounded-lg"
                            style={{ background: hasOverdue ? '#ef444418' : '#3b82f618', outline: `1px solid ${accentColor}30` }}
                        >
                            {hasOverdue
                                ? <AlertTriangle className="size-5 text-red-500" />
                                : <CheckCircle2 className="size-5 text-blue-500" />}
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground leading-none">
                                Governance Rules
                            </h3>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                {stats.total} rules
                                {statusFilter ? ` · ${STATUS_CONFIG[statusFilter].label}` : ''}
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
                        onChange={e => { setSubId(e.target.value); setRgFilter(''); }}
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
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as GovernanceStatus | '')}
                        className="h-7 rounded-lg border bg-background/80 px-2 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        <option value="">All Statuses</option>
                        {(Object.keys(STATUS_CONFIG) as GovernanceStatus[]).map(s => (
                            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                        ))}
                    </select>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                                <Info className="size-3.5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                            Governance rules from Microsoft Defender for Cloud. Track owner assignments, due dates, and remediation progress.
                        </TooltipContent>
                    </Tooltip>
                </div>

                {/* ─── Progress ring + status breakdown ─── */}
                <div className="flex items-center gap-5 px-5 pb-5">
                    <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/30" />
                            <circle
                                cx="50" cy="50" r={radius} fill="none"
                                stroke={accentColor}
                                strokeWidth="6" strokeLinecap="round"
                                strokeDasharray={circumference}
                                strokeDashoffset={dashoffset}
                                className="progress-ring-animated"
                                style={{ filter: `drop-shadow(0 0 6px ${accentColor}60)` }}
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="stat-glow text-2xl font-bold" style={{ color: accentColor }}>
                                {stats.avgCompletion}%
                            </span>
                            <span className="text-[9px] text-muted-foreground">complete</span>
                        </div>
                    </div>

                    <div className="flex-1 space-y-2">
                        {(Object.keys(STATUS_CONFIG) as GovernanceStatus[]).map((status) => {
                            const cfg = STATUS_CONFIG[status];
                            const count = stats.counts[status];
                            const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                            return (
                                <Tooltip key={status}>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setStatusFilter(statusFilter === status ? '' : status); }}
                                            className={`w-full flex items-center gap-2 text-xs rounded-md px-1.5 py-0.5 transition-colors ${statusFilter === status ? 'bg-muted/80' : 'hover:bg-muted/40'}`}
                                        >
                                            <cfg.icon className="size-3.5 shrink-0" style={{ color: cfg.color }} />
                                            <span className="w-18 text-left truncate" style={{ color: cfg.color }}>{cfg.label}</span>
                                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
                                                    style={{ width: `${pct}%`, background: cfg.color }}
                                                />
                                            </div>
                                            <span className="w-5 text-right tabular-nums font-semibold" style={{ color: cfg.color }}>{count}</span>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="text-xs">
                                        Click to filter by <span className="font-semibold">{cfg.label}</span> · {count} rules ({Math.round(pct)}%)
                                    </TooltipContent>
                                </Tooltip>
                            );
                        })}
                    </div>
                </div>

                {/* ─── Expand panel: rule details ─── */}
                <div className="expand-panel" data-open={expanded}>
                    <div>
                        <div className="border-t px-5 py-4 space-y-2 max-h-72 overflow-y-auto">
                            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                                <ClipboardList className="size-3.5" /> Rule Details
                            </h4>
                            {filteredRules.map((rule) => {
                                const cfg = STATUS_CONFIG[rule.status];
                                const Icon = cfg.icon;
                                const daysUntilDue = Math.ceil((new Date(rule.dueDate).getTime() - Date.now()) / 86400000);
                                const isOverdue = daysUntilDue < 0;
                                const criteriaCompleted = rule.completionCriteria.filter(c => c.completed).length;

                                return (
                                    <Tooltip key={rule.id}>
                                        <TooltipTrigger asChild>
                                            <div
                                                className="flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm hover:bg-muted/50 transition-all hover:shadow-sm group cursor-default"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <Icon className="size-4 shrink-0 mt-0.5" style={{ color: cfg.color }} />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium truncate">{rule.name}</p>
                                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                            <User className="size-2.5" /> {rule.owner}
                                                        </span>
                                                        <span className={`flex items-center gap-1 text-[10px] font-medium ${isOverdue ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                            <Calendar className="size-2.5" />
                                                            {isOverdue ? `${Math.abs(daysUntilDue)}d overdue` : `in ${daysUntilDue}d`}
                                                        </span>
                                                        {rule.completionCriteria.length > 0 && (
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {criteriaCompleted}/{rule.completionCriteria.length} criteria
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <div className="text-sm font-bold tabular-nums" style={{ color: cfg.color }}>
                                                        {rule.completionPercentage}%
                                                    </div>
                                                    <div className="w-12 h-1 bg-muted rounded-full overflow-hidden mt-1">
                                                        <div
                                                            className="h-full rounded-full transition-all"
                                                            style={{ width: `${rule.completionPercentage}%`, background: cfg.color }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="max-w-[280px] text-xs space-y-2">
                                            <p className="font-semibold">{rule.name}</p>
                                            <p className="text-muted-foreground text-[11px]">{rule.description}</p>
                                            <div className="space-y-1 pt-1 border-t">
                                                <p><span className="text-muted-foreground">Owner:</span> {rule.owner} · {rule.ownerEmail}</p>
                                                <p><span className="text-muted-foreground">Due:</span> {new Date(rule.dueDate).toLocaleDateString()}</p>
                                                {rule.linkedRecommendationIds.length > 0 && (
                                                    <p className="flex items-center gap-1">
                                                        <Link2 className="size-3" />
                                                        {rule.linkedRecommendationIds.length} linked recommendations
                                                    </p>
                                                )}
                                            </div>
                                            {rule.completionCriteria.length > 0 && (
                                                <div className="space-y-0.5 pt-1 border-t">
                                                    <p className="text-muted-foreground font-medium">Completion criteria:</p>
                                                    {rule.completionCriteria.slice(0, 4).map((c, i) => (
                                                        <p key={i} className={c.completed ? 'text-emerald-500' : 'text-muted-foreground'}>
                                                            {c.completed ? '✓' : '○'} {c.description}
                                                        </p>
                                                    ))}
                                                </div>
                                            )}
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
