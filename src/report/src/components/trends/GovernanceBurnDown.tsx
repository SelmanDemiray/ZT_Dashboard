import { useMemo } from 'react';
import {
    AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { TrendingDown } from 'lucide-react';
import type { BurnDownPoint } from '@/types/assessment';

interface Props {
    data: BurnDownPoint[];
}

const tooltipStyle = {
    borderRadius: '0.5rem',
    border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    fontSize: '0.75rem',
};

export function GovernanceBurnDown({ data }: Props) {
    const chartData = useMemo(() => data, [data]);

    if (data.length === 0) {
        return (
            <div className="glass-card gradient-border p-6 text-center text-sm text-muted-foreground">
                <TrendingDown size={20} className="mx-auto mb-2 opacity-40" />
                No governance burn-down data available.
            </div>
        );
    }

    /* Are we on track or behind? */
    const lastPoint = chartData[chartData.length - 1];
    const remaining = lastPoint ? lastPoint.open : 0;
    const idealRemaining = lastPoint ? (lastPoint.totalAssigned - lastPoint.idealBurnDown) : 0;
    const status = remaining <= idealRemaining ? 'on-track' : 'behind';

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <TrendingDown size={18} className="text-blue-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Governance Burn-Down</h3>
                    </div>
                    <span
                        className="text-[10px] font-medium rounded-full px-2 py-0.5 border"
                        style={{
                            borderColor: status === 'on-track' ? '#22c55e40' : '#ef444440',
                            background: status === 'on-track' ? '#22c55e10' : '#ef444410',
                            color: status === 'on-track' ? '#22c55e' : '#ef4444',
                        }}
                    >
                        {status === 'on-track' ? '✓ On Track' : '⚠ Behind Schedule'}
                    </span>
                </div>
            </div>

            <div className="p-4 sm:p-5">
                <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="openGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                            <XAxis dataKey="week" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" width={36} />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: '0.65rem' }} />
                            <Area
                                type="monotone"
                                dataKey="open"
                                name="Open Items"
                                stroke="#ef4444"
                                fill="url(#openGrad)"
                                strokeWidth={2}
                            />
                            <Line
                                type="monotone"
                                dataKey="idealBurnDown"
                                name="Ideal Burn-Down"
                                stroke="#60a5fa"
                                strokeDasharray="5 5"
                                strokeWidth={1.5}
                                dot={false}
                            />
                            <Line
                                type="monotone"
                                dataKey="actualCompleted"
                                name="Actual Completed"
                                stroke="#22c55e"
                                strokeWidth={2}
                                dot={{ r: 3, fill: '#22c55e' }}
                            />
                            {lastPoint && (
                                <ReferenceLine
                                    y={0}
                                    stroke="#22c55e50"
                                    strokeDasharray="3 3"
                                    label={{ value: 'Target', position: 'right', fontSize: 9, fill: '#22c55e' }}
                                />
                            )}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
