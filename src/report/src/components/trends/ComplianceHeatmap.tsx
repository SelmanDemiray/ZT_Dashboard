import { useState, useMemo } from 'react';
import { Grid3X3, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDateShort } from '@/lib/trends-utils';
import type { HeatmapRow, HeatmapCellState } from '@/types/assessment';

interface Props {
    rows: HeatmapRow[];
    dates: string[];
}

const STATE_COLORS: Record<HeatmapCellState, string> = {
    compliant: '#22c55e',
    nonCompliant: '#ef4444',
    investigate: '#eab308',
    notApplicable: '#475569',
};

const STATE_LABELS: Record<HeatmapCellState, string> = {
    compliant: 'Compliant',
    nonCompliant: 'Non-Compliant',
    investigate: 'Investigate',
    notApplicable: 'N/A',
};

export function ComplianceHeatmap({ rows, dates }: Props) {
    const [expandedResource, setExpandedResource] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const shortDates = useMemo(() => dates.map(d => formatDateShort(d)), [dates]);

    const filtered = useMemo(() => {
        if (!searchTerm) return rows;
        const lower = searchTerm.toLowerCase();
        return rows.filter(r =>
            r.resourceName.toLowerCase().includes(lower) ||
            r.resourceGroup.toLowerCase().includes(lower)
        );
    }, [rows, searchTerm]);

    if (rows.length === 0) {
        return (
            <div className="glass-card gradient-border p-6 text-center text-sm text-muted-foreground">
                <Grid3X3 size={20} className="mx-auto mb-2 opacity-40" />
                No heatmap data available.
            </div>
        );
    }

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Grid3X3 size={18} className="text-emerald-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Resource Compliance Heatmap</h3>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Legend */}
                        <div className="hidden sm:flex items-center gap-2">
                            {Object.entries(STATE_COLORS).map(([state, color]) => (
                                <span key={state} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                                    {STATE_LABELS[state as HeatmapCellState]}
                                </span>
                            ))}
                        </div>
                        <input
                            type="text"
                            placeholder="Filter resources…"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="h-7 w-36 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto">
                <div className="min-w-[500px]">
                    {/* Date headers */}
                    <div className="flex items-center border-b border-border/30 bg-muted/20">
                        <div className="w-48 flex-shrink-0 px-3 py-2 text-[10px] font-medium text-muted-foreground">
                            Resource
                        </div>
                        {shortDates.map((d, i) => (
                            <div key={i} className="flex-1 min-w-[40px] text-center py-2 text-[10px] text-muted-foreground">
                                {d}
                            </div>
                        ))}
                        <div className="w-20 flex-shrink-0 text-center text-[10px] text-muted-foreground py-2">
                            Streak
                        </div>
                    </div>

                    {/* Rows */}
                    <div className="max-h-[320px] overflow-y-auto">
                        {filtered.map(row => {
                            const isExpanded = expandedResource === row.resourceId;
                            return (
                                <div key={row.resourceId}>
                                    <button
                                        onClick={() => setExpandedResource(isExpanded ? null : row.resourceId)}
                                        className="w-full flex items-center hover:bg-muted/20 transition-colors"
                                    >
                                        <div className="w-48 flex-shrink-0 px-3 py-1.5 text-left">
                                            <span className="text-[11px] font-medium truncate block">{row.resourceName}</span>
                                            <span className="text-[9px] text-muted-foreground truncate block">{row.resourceGroup}</span>
                                        </div>
                                        {dates.map((d, i) => {
                                            const state = row.cells[d] || 'notApplicable';
                                            return (
                                                <div key={i} className="flex-1 min-w-[40px] flex justify-center py-1.5">
                                                    <span
                                                        className="w-5 h-5 rounded-sm transition-all hover:scale-125"
                                                        style={{
                                                            background: STATE_COLORS[state],
                                                            opacity: state === 'notApplicable' ? 0.3 : 0.85,
                                                            boxShadow: state !== 'notApplicable' ? `0 0 4px ${STATE_COLORS[state]}40` : 'none',
                                                        }}
                                                        title={`${row.resourceName} — ${d}: ${STATE_LABELS[state]}`}
                                                    />
                                                </div>
                                            );
                                        })}
                                        <div className="w-20 flex-shrink-0 flex items-center justify-center gap-1 text-[10px]">
                                            <span className={row.streak > 0 ? 'text-green-400 font-bold' : 'text-muted-foreground'}>
                                                {row.streakLabel}
                                            </span>
                                            {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                        </div>
                                    </button>
                                    {/* Expanded detail */}
                                    <div className="expand-panel" data-open={isExpanded ? 'true' : 'false'}>
                                        <div className="px-4 pb-3 pt-1 border-t border-border/20 bg-muted/10">
                                            {row.governanceRuleId && (
                                                <p className="text-[10px] text-muted-foreground mb-1">
                                                    Governance rule: <span className="font-medium text-foreground">{row.governanceRuleId}</span>
                                                </p>
                                            )}
                                            <div className="flex flex-wrap gap-3">
                                                {dates.map(d => {
                                                    const policies = row.failingPoliciesByDate[d];
                                                    if (!policies || policies.length === 0) return null;
                                                    return (
                                                        <div key={d} className="text-[10px]">
                                                            <span className="text-muted-foreground">{formatDateShort(d)}:</span>
                                                            {policies.map(p => (
                                                                <span key={p.id} className="ml-1 text-red-400">{p.name}</span>
                                                            ))}
                                                        </div>
                                                    );
                                                })}
                                            </div>
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
