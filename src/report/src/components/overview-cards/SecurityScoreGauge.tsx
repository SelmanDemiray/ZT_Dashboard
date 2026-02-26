import { useMemo } from 'react';
import { Shield, CheckCircle2, XCircle } from 'lucide-react';
import type { ZeroTrust } from '@/types/assessment';

interface Props {
    data: ZeroTrust | null;
}

const PILLAR_COLORS: Record<string, string> = {
    Identity: '#818cf8',
    Devices: '#f472b6',
    Apps: '#34d399',
    Network: '#60a5fa',
    Infrastructure: '#fbbf24',
    Data: '#a78bfa',
};

export function SecurityScoreGauge({ data }: Props) {
    const score = data?.overallScore ?? 0;
    const pillars = data?.pillars ?? [];
    const checks = data?.checks ?? [];

    const totalPassed = useMemo(() => checks.filter(c => c.status === 'passed').length, [checks]);
    const totalFailed = useMemo(() => checks.filter(c => c.status === 'failed').length, [checks]);

    /* Arc constants */
    const radius = 72;
    const stroke = 10;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;

    /* Score color gradient */
    const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';

    if (!data) return null;

    return (
        <div className="glass-card gradient-border scan-line p-5 sm:p-6 mb-6">
            <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-10">
                {/* Gauge */}
                <div className="relative flex-shrink-0">
                    <svg
                        width={200}
                        height={200}
                        viewBox="0 0 200 200"
                        className="drop-shadow-lg"
                    >
                        {/* Background circle */}
                        <circle
                            cx="100"
                            cy="100"
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={stroke}
                            className="text-muted/30"
                        />
                        {/* Score arc */}
                        <circle
                            cx="100"
                            cy="100"
                            r={radius}
                            fill="none"
                            stroke={scoreColor}
                            strokeWidth={stroke}
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={offset}
                            className="progress-ring-animated"
                            style={{
                                transform: 'rotate(-90deg)',
                                transformOrigin: '100px 100px',
                                filter: `drop-shadow(0 0 8px ${scoreColor}50)`,
                            }}
                        />
                        {/* Center text */}
                        <text
                            x="100"
                            y="92"
                            textAnchor="middle"
                            className="fill-foreground font-bold"
                            style={{ fontSize: '2.2rem' }}
                        >
                            {score}
                        </text>
                        <text
                            x="100"
                            y="118"
                            textAnchor="middle"
                            className="fill-muted-foreground"
                            style={{ fontSize: '0.75rem' }}
                        >
                            Overall Score
                        </text>
                    </svg>
                    <Shield
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.04] pointer-events-none"
                        size={130}
                    />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 text-center lg:text-left">
                    <h2 className="text-lg sm:text-xl font-semibold tracking-tight mb-1 flex items-center gap-2 justify-center lg:justify-start">
                        <Shield size={20} className="text-sky-400" />
                        Zero Trust Posture
                    </h2>
                    <p className="text-xs text-muted-foreground mb-4">{data.tenantName} — {data.runDate}</p>

                    {/* Quick stats */}
                    <div className="flex items-center gap-4 justify-center lg:justify-start mb-4">
                        <div className="flex items-center gap-1.5 text-sm">
                            <CheckCircle2 size={15} className="text-green-500" />
                            <span className="stat-glow font-semibold text-green-500">{totalPassed}</span>
                            <span className="text-muted-foreground">passed</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm">
                            <XCircle size={15} className="text-red-400" />
                            <span className="stat-glow font-semibold text-red-400">{totalFailed}</span>
                            <span className="text-muted-foreground">failed</span>
                        </div>
                    </div>

                    {/* Pillar chips */}
                    <div className="flex flex-wrap gap-2 justify-center lg:justify-start">
                        {pillars.map((p) => {
                            const color = PILLAR_COLORS[p.name] ?? '#94a3b8';
                            return (
                                <span
                                    key={p.name}
                                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-all hover:scale-105"
                                    style={{
                                        borderColor: `${color}40`,
                                        background: `${color}12`,
                                        color,
                                    }}
                                >
                                    <span
                                        className="inline-block w-2 h-2 rounded-full"
                                        style={{ background: color }}
                                    />
                                    {p.name}
                                    <span className="font-bold">{p.score}%</span>
                                </span>
                            );
                        })}
                    </div>
                </div>

                {/* Pillar mini bars */}
                <div className="hidden xl:flex flex-col gap-2 w-48 flex-shrink-0">
                    {pillars.map((p) => {
                        const color = PILLAR_COLORS[p.name] ?? '#94a3b8';
                        return (
                            <div key={p.name} className="flex items-center gap-2 text-xs">
                                <span className="w-20 truncate text-muted-foreground">{p.name}</span>
                                <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                                    <div
                                        className="h-full rounded-full transition-all duration-700"
                                        style={{
                                            width: `${p.score}%`,
                                            background: color,
                                            boxShadow: `0 0 6px ${color}50`,
                                        }}
                                    />
                                </div>
                                <span className="w-8 text-right font-semibold" style={{ color }}>{p.score}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
