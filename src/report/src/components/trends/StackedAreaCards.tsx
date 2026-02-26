import { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { Layers, ShieldAlert } from 'lucide-react';
import { formatDateShort, generatePolicyInsight, generateDefenderInsight } from '@/lib/trends-utils';
import type { PolicyCompositionPoint, DefenderSeverityPoint } from '@/types/assessment';

interface Props {
    policyData: PolicyCompositionPoint[];
    defenderData: DefenderSeverityPoint[];
}

const POLICY_SERIES = [
    { key: 'compliant', label: 'Compliant', color: '#22c55e' },
    { key: 'nonCompliant', label: 'Non-Compliant', color: '#ef4444' },
    { key: 'exempt', label: 'Exempt', color: '#eab308' },
] as const;

const DEFENDER_SERIES = [
    { key: 'critical', label: 'Critical', color: '#ef4444' },
    { key: 'high', label: 'High', color: '#f97316' },
    { key: 'medium', label: 'Medium', color: '#eab308' },
    { key: 'low', label: 'Low', color: '#22c55e' },
] as const;

const tooltipStyle = {
    borderRadius: '0.5rem',
    border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    fontSize: '0.75rem',
};

export function StackedAreaCards({ policyData, defenderData }: Props) {
    const pChart = useMemo(
        () => policyData.map(d => ({ ...d, label: formatDateShort(d.date) })),
        [policyData],
    );
    const dChart = useMemo(
        () => defenderData.map(d => ({ ...d, label: formatDateShort(d.date) })),
        [defenderData],
    );

    const policyInsight = useMemo(() => generatePolicyInsight(policyData), [policyData]);
    const defenderInsight = useMemo(() => generateDefenderInsight(defenderData), [defenderData]);

    return (
        <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
            {/* Policy composition */}
            <div className="glass-card gradient-border scan-line overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <Layers size={18} className="text-green-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Policy Compliance Composition</h3>
                    </div>
                    {policyInsight && (
                        <p className="text-[11px] text-muted-foreground mt-1">{policyInsight}</p>
                    )}
                </div>
                <div className="p-4 sm:p-5">
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={pChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                                <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" width={36} />
                                <Tooltip contentStyle={tooltipStyle} />
                                <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: '0.65rem' }} />
                                {POLICY_SERIES.map(s => (
                                    <Area
                                        key={s.key}
                                        type="monotone"
                                        dataKey={s.key}
                                        name={s.label}
                                        stackId="policy"
                                        stroke={s.color}
                                        fill={`${s.color}30`}
                                    />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Defender severity */}
            <div className="glass-card gradient-border scan-line overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <ShieldAlert size={18} className="text-orange-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Defender Recs by Severity</h3>
                    </div>
                    {defenderInsight && (
                        <p className="text-[11px] text-muted-foreground mt-1">{defenderInsight}</p>
                    )}
                </div>
                <div className="p-4 sm:p-5">
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                                <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" width={36} />
                                <Tooltip contentStyle={tooltipStyle} />
                                <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: '0.65rem' }} />
                                {DEFENDER_SERIES.map(s => (
                                    <Area
                                        key={s.key}
                                        type="monotone"
                                        dataKey={s.key}
                                        name={s.label}
                                        stackId="defender"
                                        stroke={s.color}
                                        fill={`${s.color}30`}
                                    />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
