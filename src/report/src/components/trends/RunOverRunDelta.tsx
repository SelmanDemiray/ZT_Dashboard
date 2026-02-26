import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import type { DeltaRow } from '@/types/assessment';

interface Props {
    date1: string;
    date2: string;
    rows: DeltaRow[];
}

const DIRECTION_CONFIG = {
    improved: { icon: ArrowUpRight, color: '#22c55e', bgColor: '#22c55e10', borderColor: '#22c55e30' },
    regressed: { icon: ArrowDownRight, color: '#ef4444', bgColor: '#ef444410', borderColor: '#ef444430' },
    unchanged: { icon: Minus, color: '#94a3b8', bgColor: '#94a3b810', borderColor: '#94a3b830' },
} as const;

export function RunOverRunDelta({ date1, date2, rows }: Props) {
    const improvements = rows.filter(r => r.direction === 'improved');
    const regressions = rows.filter(r => r.direction === 'regressed');
    const unchanged = rows.filter(r => r.direction === 'unchanged');

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
                        <ArrowUpRight size={18} className="text-green-400" />
                        Run-over-Run Delta
                    </h3>
                    <span className="text-[10px] text-muted-foreground">
                        {date1} → {date2}
                    </span>
                </div>
            </div>

            <div className="p-4 sm:p-5">
                {/* Summary badges */}
                <div className="flex flex-wrap gap-2 mb-4">
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/20">
                        <ArrowUpRight size={10} /> {improvements.length} improved
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-2.5 py-1 bg-red-500/10 text-red-400 border border-red-500/20">
                        <ArrowDownRight size={10} /> {regressions.length} regressed
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-2.5 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20">
                        <Minus size={10} /> {unchanged.length} unchanged
                    </span>
                </div>

                {/* Delta rows */}
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                    {rows.map((row, i) => {
                        const cfg = DIRECTION_CONFIG[row.direction];
                        const Icon = cfg.icon;
                        return (
                            <div
                                key={i}
                                className="flex items-center gap-3 p-2.5 rounded-lg border transition-all hover:bg-muted/20"
                                style={{ borderColor: cfg.borderColor, background: cfg.bgColor }}
                            >
                                <Icon size={16} style={{ color: cfg.color }} className="flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <span className="text-xs font-medium">{row.metric}</span>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">{row.explanation}</p>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0 text-xs">
                                    <span className="text-muted-foreground">{row.before}</span>
                                    <span className="text-muted-foreground/50">→</span>
                                    <span className="font-bold" style={{ color: cfg.color }}>{row.after}</span>
                                    <span
                                        className="font-mono text-[10px] font-medium min-w-[40px] text-right"
                                        style={{ color: cfg.color }}
                                    >
                                        {row.change > 0 ? '+' : ''}{row.change}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
