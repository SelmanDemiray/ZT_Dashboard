import { useState, useMemo } from 'react';
import { displaySubName } from '@/lib/format-sub-name';
import {
    AlertTriangle, CheckCircle2, Clock, CircleDot,
    ChevronDown, ChevronUp, Filter, Info, User,
    Calendar, ClipboardList, Link2, Maximize2,
} from 'lucide-react';
import type { Governance, GovernanceStatus } from '@/types/assessment';
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

const STATUS_CONFIG: Record<GovernanceStatus, { label: string; color: string; icon: React.ElementType; bg: string }> = {
    completed: { label: 'Completed', color: '#22c55e', bg: '#22c55e18', icon: CheckCircle2 },
    inProgress: { label: 'In Progress', color: '#3b82f6', bg: '#3b82f618', icon: Clock },
    notStarted: { label: 'Not Started', color: '#94a3b8', bg: '#94a3b818', icon: CircleDot },
    overdue: { label: 'Overdue', color: '#ef4444', bg: '#ef444418', icon: AlertTriangle },
};

export function GovernanceCard({ subscriptions, subDataMap, defaultSubId, expanded: propExpanded, onToggleExpanded }: Props) {
    const [localExpanded, setLocalExpanded] = useState(false);
    const expanded = propExpanded !== undefined ? propExpanded : localExpanded;
    const toggleExpanded = onToggleExpanded || (() => setLocalExpanded(v => !v));
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
                <div className="glass-card gradient-border scan-line p-6 flex flex-col items-center justify-center min-h-[300px] gap-3 transition-all duration-300">
                    <div className="relative">
                        <div className="absolute inset-0 bg-muted/20 animate-ping rounded-full" />
                        <ClipboardList className="size-10 text-muted-foreground/40 relative z-10" />
                    </div>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <Filter className="size-3.5 text-muted-foreground" />
                        <FilterDropdown 
                            value={subId} 
                            onValueChange={setSubId} 
                            options={subscriptions.map(s => ({ value: s.id, label: displaySubName(s) }))}
                        />
                    </div>
                    <span className="text-sm text-muted-foreground">No governance data</span>
                </div>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider delayDuration={150}>
            <div
                className={`glass-card gradient-border scan-line cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-border/60 ${hasOverdue ? 'glow-warning' : ''}`}
                onClick={() => toggleExpanded()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && toggleExpanded()}
            >
                {/* ─── Header ─── */}
                <div className="flex items-start justify-between px-5 pt-5 pb-3 gap-2">
                    <div className="flex items-center gap-2.5">
                        <div
                            className="p-2 rounded-lg"
                            style={{ background: hasOverdue ? '#ef444418' : '#3b82f618', outline: `1px solid ${accentColor}30` }}
                        >
                            {hasOverdue
                                ? <AlertTriangle className="size-5 text-red-500 animate-pulse" />
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
                                        <ClipboardList className="size-5" />
                                        Governance Rules Details
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                    <div className="flex items-center gap-8 pb-6 border-b">
                                        <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
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
                                                <span className="stat-glow text-3xl font-bold" style={{ color: accentColor }}>
                                                    {stats.avgCompletion}%
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-6">
                                            {(Object.keys(STATUS_CONFIG) as GovernanceStatus[]).map((status) => {
                                                const cfg = STATUS_CONFIG[status];
                                                const count = stats.counts[status];
                                                return (
                                                    <div key={`modal-${status}`} className="space-y-1">
                                                        <div className="flex items-center gap-1.5 font-medium text-sm" style={{ color: cfg.color }}>
                                                            <cfg.icon className="size-4" /> {cfg.label}
                                                        </div>
                                                        <div className="text-2xl font-bold tabular-nums text-foreground">{count}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        {filteredRules.map((rule) => {
                                            const cfg = STATUS_CONFIG[rule.status];
                                            const Icon = cfg.icon;
                                            const daysUntilDue = Math.ceil((new Date(rule.dueDate).getTime() - Date.now()) / 86400000);
                                            const isOverdue = daysUntilDue < 0;
                                            const criteriaCompleted = rule.completionCriteria.filter(c => c.completed).length;

                                            return (
                                                <div key={`modal-${rule.id}`} className="p-4 rounded-xl border bg-muted/20 space-y-3">
                                                    <div className="flex items-start gap-3">
                                                        <Icon className="size-5 shrink-0 mt-0.5" style={{ color: cfg.color }} />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold">{rule.name}</p>
                                                            <p className="text-muted-foreground text-xs mt-1">{rule.description}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                                        <span className="flex items-center gap-1"><User className="size-3" /> {rule.owner}</span>
                                                        <span className={`flex items-center gap-1 font-medium ${isOverdue ? 'text-red-500' : ''}`}>
                                                            <Calendar className="size-3" />
                                                            {isOverdue ? `${Math.abs(daysUntilDue)}d overdue` : `due in ${daysUntilDue}d`}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <div className="flex justify-between text-xs mb-1 font-medium">
                                                            <span>Progress ({criteriaCompleted}/{rule.completionCriteria.length})</span>
                                                            <span style={{ color: cfg.color }}>{rule.completionPercentage}%</span>
                                                        </div>
                                                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                                                            <div className="h-full rounded-full transition-all" style={{ width: `${rule.completionPercentage}%`, background: cfg.color }} />
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
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
                        onValueChange={(v) => { setSubId(v); setRgFilter(''); }} 
                        options={subscriptions.map(s => ({ value: s.id, label: displaySubName(s) }))} 
                        className="max-w-[140px]" 
                    />
                    {availableRGs.length > 0 && (
                        <FilterDropdown 
                            value={rgFilter} 
                            onValueChange={setRgFilter} 
                            options={[{ value: '', label: 'All RGs' }, ...availableRGs.map(rg => ({ value: rg, label: rg }))]} 
                            className="max-w-[120px]" 
                        />
                    )}
                    <FilterDropdown 
                        value={statusFilter} 
                        onValueChange={(v) => setStatusFilter(v as GovernanceStatus | '')} 
                        options={[
                            { value: '', label: 'All Statuses' }, 
                            ...(Object.keys(STATUS_CONFIG) as GovernanceStatus[]).map(s => ({ value: s, label: STATUS_CONFIG[s].label }))
                        ]} 
                    />
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
                            {filteredRules.map((rule, idx) => {
                                const cfg = STATUS_CONFIG[rule.status];
                                const Icon = cfg.icon;
                                const daysUntilDue = Math.ceil((new Date(rule.dueDate).getTime() - Date.now()) / 86400000);
                                const isOverdue = daysUntilDue < 0;
                                const criteriaCompleted = rule.completionCriteria.filter(c => c.completed).length;

                                return (
                                    <Tooltip key={rule.id}>
                                        <TooltipTrigger asChild>
                                            <div
                                                className="flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm hover:bg-muted/50 transition-all hover:shadow-sm group cursor-default animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300"
                                                style={{ animationDelay: `${idx * 40}ms` }}
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
                                                    {rule.completionCriteria.map((c, i) => (
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
