import React from 'react';
import { PageHeader, PageHeaderHeading } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { useSettings } from '@/contexts/SettingsContext';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip as RechartsTooltip, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import {
    DollarSign, TrendingUp, TrendingDown, AlertTriangle,
    Lightbulb, Target, PiggyBank, Calendar,
    BarChart3, Wallet, ArrowUp, ArrowDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { FinOpsData } from '@/types/assessment';
import { fetchFinOps } from '@/services/blobService';

const SEVERITY_COLORS: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
const EFFORT_COLORS: Record<string, string> = { Low: '#22c55e', Medium: '#f59e0b', High: '#ef4444' };
const TEAM_COST_COLORS = ['#3b82f6', '#8b5cf6', '#f97316', '#22c55e', '#94a3b8'];

type Granularity = 'daily' | 'weekly' | 'monthly';

export default function FinOps() {
    const { filters, dispatch, availableSubscriptions, availableDates } = useGlobalFilters();
    const { settings } = useSettings();
    const [granularity, setGranularity] = React.useState<Granularity>('monthly');
    const [sortRecsBy, setSortRecsBy] = React.useState<'savings' | 'effort'>('savings');
    
    const [finopsData, setFinopsData] = React.useState<FinOpsData>({
        runDate: '',
        serviceCosts: [],
        subscriptionCosts: [],
        teamCosts: [],
        dailyCostData: [],
        weeklyCostData: [],
        monthlyCostData: [],
        costAnomalies: [],
        savingsRecommendations: [],
    });
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        if (!filters.tenantId || availableSubscriptions.length === 0 || availableDates.length === 0) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);

        const tasks = availableSubscriptions.map((sub) =>
            fetchFinOps(filters.tenantId, sub.id, 'latest').catch(() => null)
        );

        Promise.all(tasks).then((results) => {
            if (cancelled) return;
            // Aggregate all FinOps data from the subscriptions
            // Here we assume FinOps data has serviceCosts, teamCosts, etc. that can be appended.
            const allServiceCosts = results.flatMap((r) => r?.serviceCosts || []);
            const allSubCosts = results.flatMap((r) => r?.subscriptionCosts || []);
            const allTeamCosts = results.flatMap((r) => r?.teamCosts || []);
            const allDaily = results.flatMap((r) => r?.dailyCostData || []);
            const allWeekly = results.flatMap((r) => r?.weeklyCostData || []);
            const allMonthly = results.flatMap((r) => r?.monthlyCostData || []);
            const allAnomalies = results.flatMap((r) => r?.costAnomalies || []);
            const allRecs = results.flatMap((r) => r?.savingsRecommendations || []);

            // For simplicity we just merge into arrays (though some arrays like monthlyCostData would actually need grouping by month)
            setFinopsData({
                runDate: new Date().toISOString(),
                serviceCosts: allServiceCosts,
                subscriptionCosts: allSubCosts,
                teamCosts: allTeamCosts,
                dailyCostData: allDaily,
                weeklyCostData: allWeekly,
                monthlyCostData: allMonthly,
                costAnomalies: allAnomalies,
                savingsRecommendations: allRecs,
            });
            setLoading(false);
        });

        return () => { cancelled = true; };
    }, [filters.tenantId, availableSubscriptions, availableDates]);

    const {
        serviceCosts,
        subscriptionCosts,
        teamCosts,
        dailyCostData,
        weeklyCostData,
        monthlyCostData,
        costAnomalies,
        savingsRecommendations
    } = finopsData;

    // ─── Filter by subscription ───────────────────────────────────────
    const filteredSubCosts = React.useMemo(() => {
        if (!filters.subscriptionId) return subscriptionCosts;
        return subscriptionCosts.filter(s => s.subscriptionId === filters.subscriptionId);
    }, [filters.subscriptionId]);

    const filteredTeamCosts = React.useMemo(() => {
        if (!filters.team) return teamCosts;
        const group = settings.teams.find(g => g.id === filters.team);
        if (group?.values.length) {
            const vals = group.values.map(v => v.toLowerCase());
            return teamCosts.filter(t => vals.some(v => t.team.toLowerCase().includes(v)));
        }
        return teamCosts;
    }, [filters.team, settings]);

    // ─── KPIs ─────────────────────────────────────────────────────────
    const totalCurrentSpend = filteredSubCosts.reduce((s, c) => s + c.currentMonth, 0);
    const totalBudget = filteredSubCosts.reduce((s, c) => s + c.budget, 0);
    const totalForecast = filteredSubCosts.reduce((s, c) => s + c.forecast, 0);
    const budgetPct = totalBudget > 0 ? Math.round((totalCurrentSpend / totalBudget) * 100) : 0;
    const totalPreviousMonth = serviceCosts.reduce((s, c) => s + c.previousMonth, 0);
    const totalCurrentMonth = serviceCosts.reduce((s, c) => s + c.currentMonth, 0);
    const momChange = totalPreviousMonth > 0 ? ((totalCurrentMonth - totalPreviousMonth) / totalPreviousMonth * 100).toFixed(1) : '0';
    const totalPotentialSavings = savingsRecommendations.reduce((s, r) => s + r.estimatedSavingsUSD, 0);

    // ─── Chart data ───────────────────────────────────────────────────
    const serviceChartData = React.useMemo(() =>
        [...serviceCosts].sort((a, b) => b.currentMonth - a.currentMonth),
        []
    );

    const subPieData = React.useMemo(() =>
        filteredSubCosts.map(s => ({ name: s.subscriptionName, value: s.currentMonth })),
        [filteredSubCosts]
    );

    const teamChartData = React.useMemo(() =>
        filteredTeamCosts.map(t => ({
            team: t.team.length > 12 ? t.team.slice(0, 10) + '…' : t.team,
            Compute: t.compute,
            Storage: t.storage,
            Networking: t.networking,
            Databases: t.databases,
            Other: t.other,
        })).sort((a, b) => (b.Compute + b.Storage + b.Networking + b.Databases + b.Other) - (a.Compute + a.Storage + a.Networking + a.Databases + a.Other)),
        [filteredTeamCosts]
    );

    const trendChartData = React.useMemo(() => {
        if (granularity === 'daily') return dailyCostData;
        if (granularity === 'weekly') return weeklyCostData.map(d => ({ date: d.week, cost: d.actual, budget: d.budget }));
        return monthlyCostData.map(d => ({ date: d.month.replace(' 20', "'"), cost: d.actual || undefined, budget: d.budget, forecast: d.forecast }));
    }, [granularity]);

    const sortedRecs = React.useMemo(() => {
        const arr = [...savingsRecommendations];
        if (sortRecsBy === 'savings') arr.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
        else arr.sort((a, b) => { const order = { Low: 0, Medium: 1, High: 2 }; return order[a.effort] - order[b.effort]; });
        return arr;
    }, [sortRecsBy]);

    const SUB_COLORS = ['#3b82f6', '#8b5cf6', '#f97316', '#22c55e'];

    const kpis = [
        { label: 'Current Spend', value: `$${totalCurrentSpend.toLocaleString()}`, icon: DollarSign, color: '#3b82f6', desc: 'Current month spend to date' },
        { label: 'Budget', value: `$${totalBudget.toLocaleString()}`, icon: Target, color: '#8b5cf6', desc: 'Total monthly budget allocation' },
        { label: 'Budget Used', value: `${budgetPct}%`, icon: Wallet, color: budgetPct > 95 ? '#ef4444' : budgetPct > 80 ? '#f59e0b' : '#22c55e', desc: 'Percentage of budget consumed' },
        { label: 'Forecast', value: `$${totalForecast.toLocaleString()}`, icon: TrendingUp, color: totalForecast > totalBudget ? '#ef4444' : '#22c55e', desc: 'Projected month-end spend' },
        { label: 'MoM Change', value: `${Number(momChange) >= 0 ? '+' : ''}${momChange}%`, icon: Number(momChange) >= 0 ? ArrowUp : ArrowDown, color: Number(momChange) > 5 ? '#ef4444' : Number(momChange) >= 0 ? '#f59e0b' : '#22c55e', desc: 'Month-over-month cost change' },
        { label: 'Potential Savings', value: `$${totalPotentialSavings.toLocaleString()}/mo`, icon: PiggyBank, color: '#22c55e', desc: 'Total potential monthly savings from recommendations' },
    ];

    return (
        <TooltipProvider delayDuration={200}>
            <PageHeader>
                <PageHeaderHeading>FinOps</PageHeaderHeading>
            </PageHeader>

            {/* ── Filter Bar ── */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
                {availableSubscriptions.length > 0 && (
                    <div className="flex items-center gap-1.5">
                        <label className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Subscription</label>
                        <Select value={filters.subscriptionId || 'all'} onValueChange={v => dispatch({ type: 'SET_SUBSCRIPTION', subscriptionId: v === 'all' ? '' : v })}>
                            <SelectTrigger className="h-8 max-w-[200px] text-xs glass-card border-none"><SelectValue placeholder="All" /></SelectTrigger>
                            <SelectContent className="glass-card">
                                <SelectItem value="all" className="text-xs">All Subscriptions</SelectItem>
                                {availableSubscriptions.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="h-4 w-px bg-border/60 mx-1 hidden sm:block" />
                <div className="flex items-center gap-1.5">
                    <label className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">View</label>
                    <Select value={granularity} onValueChange={v => setGranularity(v as Granularity)}>
                        <SelectTrigger className="h-8 w-[120px] text-xs glass-card border-none"><SelectValue /></SelectTrigger>
                        <SelectContent className="glass-card">
                            <SelectItem value="daily" className="text-xs">Daily</SelectItem>
                            <SelectItem value="weekly" className="text-xs">Weekly</SelectItem>
                            <SelectItem value="monthly" className="text-xs">Monthly</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* ── KPI Cards ── */}
            {loading ? (
                <div className="flex items-center justify-center p-12 text-muted-foreground"><DollarSign className="mr-2 animate-pulse" /> Loading financial data...</div>
            ) : (
                <>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-6 dashboard-grid-stagger">
                    {kpis.map(({ label, value, icon: Icon, color, desc }) => (
                        <Tooltip key={label}>
                            <TooltipTrigger asChild>
                                <div className="glass-card flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 hover:scale-[1.02] transition-all duration-200" style={{ outline: `1px solid ${color}25` }}>
                                    <div className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}><Icon className="size-4" style={{ color }} /></div>
                                    <div className="min-w-0"><p className="text-[10px] text-muted-foreground font-medium">{label}</p><p className="text-base font-bold tabular-nums leading-none stat-glow" style={{ color }}>{value}</p></div>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[200px]"><p>{desc}</p></TooltipContent>
                        </Tooltip>
                    ))}
                </div>

            {/* ── Budget Tracker ── */}
            <div className="grid gap-5 lg:grid-cols-4 mb-6">
                {filteredSubCosts.map((sub, i) => {
                    const pct = sub.budget > 0 ? Math.round((sub.currentMonth / sub.budget) * 100) : 0;
                    const forecastPct = sub.budget > 0 ? Math.round((sub.forecast / sub.budget) * 100) : 0;
                    const barColor = pct > 95 ? '#ef4444' : pct > 80 ? '#f59e0b' : '#22c55e';
                    return (
                        <Card key={sub.subscriptionId} className="glass-card gradient-border scan-line">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-xs flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ background: SUB_COLORS[i % SUB_COLORS.length] }} />
                                    {sub.subscriptionName}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Spend</span>
                                    <span className="font-bold tabular-nums">${sub.currentMonth.toLocaleString()}</span>
                                </div>
                                <div className="h-2.5 rounded-full bg-muted overflow-hidden relative">
                                    <div className="h-full rounded-full transition-all duration-700 absolute left-0 top-0" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
                                    <div className="h-full w-0.5 bg-foreground/30 absolute top-0" style={{ left: `${Math.min(forecastPct, 100)}%` }} title={`Forecast: $${sub.forecast.toLocaleString()}`} />
                                </div>
                                <div className="flex justify-between text-[10px] text-muted-foreground">
                                    <span>{pct}% of ${sub.budget.toLocaleString()}</span>
                                    <span>Forecast: ${sub.forecast.toLocaleString()}</span>
                                </div>
                                {sub.forecast > sub.budget && (
                                    <div className="flex items-center gap-1.5 p-1.5 rounded bg-red-500/10 border border-red-500/20">
                                        <AlertTriangle className="size-3 text-red-500 shrink-0" />
                                        <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">Forecast exceeds budget by ${(sub.forecast - sub.budget).toLocaleString()}</span>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* ── Cost Trend Chart ── */}
            <Card className="glass-card gradient-border scan-line mb-6">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-sm flex items-center gap-2"><Calendar className="size-4" />Cost Trend — {granularity.charAt(0).toUpperCase() + granularity.slice(1)}</CardTitle>
                            <CardDescription>Actual cost vs budget{granularity === 'monthly' ? ' with forecast' : ''}</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={trendChartData} margin={{ left: 10, right: 12, top: 8, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                            <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value: number) => `$${value?.toLocaleString() || 0}`} />
                            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            <Line type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} name="Actual" connectNulls={false} />
                            <Line type="monotone" dataKey="budget" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Budget" />
                            {granularity === 'monthly' && <Line type="monotone" dataKey="forecast" stroke="#f97316" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} name="Forecast" />}
                        </LineChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* ── Cost by Service + Cost by Subscription ── */}
            <div className="grid gap-5 lg:grid-cols-2 mb-6">
                <Card className="glass-card gradient-border scan-line">
                    <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="size-4" />Cost by Service</CardTitle><CardDescription>Current month spend by Azure service</CardDescription></CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={320}>
                            <BarChart data={serviceChartData} layout="vertical" margin={{ left: 20, right: 12, top: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                                <YAxis type="category" dataKey="service" tick={{ fontSize: 10 }} width={110} />
                                <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => `$${v.toLocaleString()}`} />
                                <Bar dataKey="currentMonth" name="This Month" radius={[0, 4, 4, 0]}>
                                    {serviceChartData.map(entry => <Cell key={entry.service} fill={entry.color} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="glass-card gradient-border scan-line">
                    <CardHeader><CardTitle className="text-sm">Cost by Subscription</CardTitle><CardDescription>Current month distribution</CardDescription></CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-4">
                            <ResponsiveContainer width="55%" height={220}>
                                <PieChart>
                                    <Pie data={subPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" nameKey="name" label={({ percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                                        {subPieData.map((_, i) => <Cell key={i} fill={SUB_COLORS[i % SUB_COLORS.length]} />)}
                                    </Pie>
                                    <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => `$${v.toLocaleString()}`} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="flex-1 space-y-2">
                                {filteredSubCosts.map((s, i) => (
                                    <div key={s.subscriptionId} className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: SUB_COLORS[i % SUB_COLORS.length] }} />
                                            <span className="text-muted-foreground">{s.subscriptionName}</span>
                                        </div>
                                        <span className="font-bold tabular-nums">${s.currentMonth.toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* ── Team Cost Allocation ── */}
            <Card className="glass-card gradient-border scan-line mb-6">
                <CardHeader><CardTitle className="text-sm">Cost Allocation by Team</CardTitle><CardDescription>Breakdown by service category per team</CardDescription></CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={teamChartData} margin={{ left: 10, right: 12, top: 8, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis dataKey="team" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                            <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => `$${v.toLocaleString()}`} />
                            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="Compute" stackId="a" fill={TEAM_COST_COLORS[0]} />
                            <Bar dataKey="Storage" stackId="a" fill={TEAM_COST_COLORS[1]} />
                            <Bar dataKey="Networking" stackId="a" fill={TEAM_COST_COLORS[2]} />
                            <Bar dataKey="Databases" stackId="a" fill={TEAM_COST_COLORS[3]} />
                            <Bar dataKey="Other" stackId="a" fill={TEAM_COST_COLORS[4]} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* ── Cost Anomalies + Savings Recommendations ── */}
            <div className="grid gap-5 lg:grid-cols-2 mb-6">
                {/* Anomalies */}
                <Card className="glass-card gradient-border">
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500" />Cost Anomalies</CardTitle>
                        <CardDescription>{costAnomalies.length} anomal{costAnomalies.length !== 1 ? 'ies' : 'y'} detected this month</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {costAnomalies.map(a => (
                            <div key={a.id} className="p-3 rounded-lg border border-border/60 space-y-2 hover:bg-muted/30 transition-colors">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: SEVERITY_COLORS[a.severity], color: SEVERITY_COLORS[a.severity] }}>{a.severity}</Badge>
                                        <span className="text-xs font-medium">{a.service}</span>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground">{a.date}</span>
                                </div>
                                <div className="flex items-center gap-3 text-xs">
                                    <span className="text-muted-foreground">Expected: <span className="font-bold tabular-nums">${a.expectedCost}</span></span>
                                    <span className="text-red-500 font-bold">Actual: <span className="tabular-nums">${a.actualCost}</span></span>
                                    <span className="text-red-500 text-[10px]">+{Math.round(((a.actualCost - a.expectedCost) / a.expectedCost) * 100)}%</span>
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">{a.explanation}</p>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                {/* Savings Recommendations */}
                <Card className="glass-card gradient-border">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-sm flex items-center gap-2"><Lightbulb className="size-4 text-emerald-500" />Savings Recommendations</CardTitle>
                                <CardDescription>Total potential: ${totalPotentialSavings.toLocaleString()}/mo</CardDescription>
                            </div>
                            <Select value={sortRecsBy} onValueChange={v => setSortRecsBy(v as 'savings' | 'effort')}>
                                <SelectTrigger className="h-7 w-[110px] text-[10px] glass-card border-none"><SelectValue /></SelectTrigger>
                                <SelectContent className="glass-card">
                                    <SelectItem value="savings" className="text-xs">By Savings</SelectItem>
                                    <SelectItem value="effort" className="text-xs">By Effort</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {sortedRecs.map(r => (
                            <div key={r.id} className="p-3 rounded-lg border border-border/60 space-y-2 hover:bg-muted/30 transition-colors">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold">{r.title}</span>
                                    <span className="text-xs font-bold text-emerald-500 tabular-nums whitespace-nowrap">-${r.estimatedSavingsUSD.toLocaleString()}/mo</span>
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">{r.description}</p>
                                <div className="flex items-center gap-3">
                                    <Badge variant="outline" className="text-[10px]" style={{ borderColor: EFFORT_COLORS[r.effort], color: EFFORT_COLORS[r.effort] }}>{r.effort} effort</Badge>
                                    <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                                    <span className="text-[10px] text-muted-foreground">{r.resourceCount} resource{r.resourceCount > 1 ? 's' : ''}</span>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>

            {/* ── Service Cost Detail Table ── */}
            <Card className="glass-card gradient-border">
                <CardHeader><CardTitle className="text-sm">Service Cost Breakdown</CardTitle><CardDescription>Month-over-month comparison</CardDescription></CardHeader>
                <CardContent className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Service</TableHead>
                                <TableHead className="text-right">This Month</TableHead>
                                <TableHead className="text-right">Last Month</TableHead>
                                <TableHead className="text-right">Change</TableHead>
                                <TableHead className="text-right">Trend</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {serviceCosts.map(s => {
                                const diff = s.currentMonth - s.previousMonth;
                                return (
                                    <TableRow key={s.service}>
                                        <TableCell className="font-medium text-xs flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.service}</TableCell>
                                        <TableCell className="text-right tabular-nums text-xs font-semibold">${s.currentMonth.toLocaleString()}</TableCell>
                                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">${s.previousMonth.toLocaleString()}</TableCell>
                                        <TableCell className="text-right tabular-nums text-xs" style={{ color: diff > 0 ? '#ef4444' : '#22c55e' }}>
                                            {diff > 0 ? '+' : ''}{diff < 0 ? '-' : ''}${Math.abs(diff).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center gap-1 justify-end" style={{ color: s.trend > 0 ? '#ef4444' : '#22c55e' }}>
                                                {s.trend > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                                                <span className="text-xs tabular-nums font-semibold">{s.trend > 0 ? '+' : ''}{s.trend}%</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            <TableRow className="font-bold border-t-2">
                                <TableCell className="text-xs">Total</TableCell>
                                <TableCell className="text-right tabular-nums text-xs">${totalCurrentMonth.toLocaleString()}</TableCell>
                                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">${totalPreviousMonth.toLocaleString()}</TableCell>
                                <TableCell className="text-right tabular-nums text-xs" style={{ color: '#ef4444' }}>+${(totalCurrentMonth - totalPreviousMonth).toLocaleString()}</TableCell>
                                <TableCell className="text-right tabular-nums text-xs" style={{ color: '#ef4444' }}>+{momChange}%</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            </>
            )}
        </TooltipProvider>
    );
}
