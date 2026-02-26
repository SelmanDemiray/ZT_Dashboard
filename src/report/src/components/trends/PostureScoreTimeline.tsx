import { useMemo } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { formatDateShort } from '@/lib/trends-utils';
import type { TrendDataPoint } from '@/types/assessment';

interface Props {
    data: TrendDataPoint[];
}

const SERIES = [
    { key: 'ztScore', label: 'Zero Trust Score', color: '#06b6d4' },
    { key: 'secureScore', label: 'Secure Score', color: '#8b5cf6' },
    { key: 'policyCompliancePct', label: 'Policy Compliance %', color: '#22c55e' },
    { key: 'governanceCompletionPct', label: 'Governance %', color: '#f59e0b' },
] as const;

export function PostureScoreTimeline({ data }: Props) {
    const chartData = useMemo(() =>
        data.map(d => ({ ...d, label: formatDateShort(d.date) })),
        [data],
    );

    if (data.length === 0) {
        return (
            <div className="glass-card gradient-border p-6 text-center text-sm text-muted-foreground">
                <TrendingUp size={20} className="mx-auto mb-2 opacity-40" />
                No data available for the posture timeline.
            </div>
        );
    }

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <TrendingUp size={18} className="text-cyan-400" />
                    <h3 className="text-sm font-semibold tracking-tight">Overall Posture Score Timeline</h3>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                    Multi-series view of key metrics over time
                </p>
            </div>

            <div className="p-4 sm:p-5">
                <div className="h-[300px] sm:h-[350px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 10 }}
                                className="text-muted-foreground"
                            />
                            <YAxis
                                domain={[0, 100]}
                                tick={{ fontSize: 10 }}
                                className="text-muted-foreground"
                                width={36}
                            />
                            <Tooltip
                                contentStyle={{
                                    borderRadius: '0.5rem',
                                    border: '1px solid hsl(var(--border))',
                                    background: 'hsl(var(--popover))',
                                    color: 'hsl(var(--popover-foreground))',
                                    fontSize: '0.75rem',
                                }}
                            />
                            <Legend
                                verticalAlign="top"
                                height={28}
                                wrapperStyle={{ fontSize: '0.7rem' }}
                            />
                            {SERIES.map(s => (
                                <Line
                                    key={s.key}
                                    type="monotone"
                                    dataKey={s.key}
                                    name={s.label}
                                    stroke={s.color}
                                    strokeWidth={2}
                                    dot={{ r: 3, fill: s.color }}
                                    activeDot={{ r: 5 }}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
