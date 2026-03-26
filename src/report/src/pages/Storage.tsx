import React from 'react';
import { PageHeader, PageHeaderHeading } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { fetchStorageAccounts, fetchFinOps } from '@/services/blobService';
import type { FinOpsData } from '@/types/assessment';
import type { StorageAccount } from '@/types/assessment';
import { useSettings } from '@/contexts/SettingsContext';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    LineChart,
    Line,
    Legend,
} from 'recharts';
import { HardDrive, Database, TrendingUp, DollarSign, Lock, Unlock, ArrowUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const CAPACITY_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899'];

const TIER_COLORS: Record<string, string> = {
    Hot: '#f97316',
    Cool: '#3b82f6',
    Archive: '#8b5cf6',
};

type SortField = 'name' | 'totalCapacity' | 'monthlyCostUSD' | 'accessTier';
type SortDir = 'asc' | 'desc';

export default function Storage() {
    const { filters, dispatch, availableSubscriptions, availableDates } = useGlobalFilters();
    const { settings } = useSettings();
    const [sortField, setSortField] = React.useState<SortField>('totalCapacity');
    const [sortDir, setSortDir] = React.useState<SortDir>('desc');
    const [filterTier, setFilterTier] = React.useState<string>('all');

    const [storageAccounts, setStorageAccounts] = React.useState<StorageAccount[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [costTrendData, setCostTrendData] = React.useState<{ month: string; cost: number; egress: number }[]>([]);

    React.useEffect(() => {
        if (!filters.tenantId || availableSubscriptions.length === 0) {
            setStorageAccounts([]);
            setCostTrendData([]);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);

        const storageTasks = availableSubscriptions.map((sub) =>
            fetchStorageAccounts(filters.tenantId, sub.id, 'latest').catch(() => null)
        );
        const finopsTasks = availableSubscriptions.map((sub) =>
            fetchFinOps(filters.tenantId, sub.id, 'latest').catch((): FinOpsData | null => null)
        );

        Promise.all([Promise.all(storageTasks), Promise.all(finopsTasks)]).then(([storageResults, finopsResults]) => {
            if (cancelled) return;
            const allAccounts = storageResults.flatMap((r) => r?.accounts || []);
            setStorageAccounts(allAccounts);

            // Build cost trend from real FinOps monthly data
            const monthlyMap = new Map<string, { cost: number; egress: number }>();
            for (const finops of finopsResults) {
                if (!finops?.monthlyCostData) continue;
                for (const entry of finops.monthlyCostData) {
                    const existing = monthlyMap.get(entry.month) || { cost: 0, egress: 0 };
                    existing.cost += entry.actual;
                    monthlyMap.set(entry.month, existing);
                }
            }
            // Add real egress from storage accounts (total across all accounts)
            const totalEgress = allAccounts.reduce((s, a) => s + (a.egressGB30d || 0), 0);
            const trendEntries = Array.from(monthlyMap.entries())
                .map(([month, data]) => ({ month, cost: Math.round(data.cost), egress: Math.round(totalEgress) }))
                .sort((a, b) => a.month.localeCompare(b.month));
            setCostTrendData(trendEntries);

            setLoading(false);
        });

        return () => { cancelled = true; };
    }, [filters.tenantId, availableSubscriptions, availableDates]);

    // ─── Apply global filters ─────────────────────────────────────────
    const filtered = React.useMemo(() => {
        let result = storageAccounts;

        if (filters.subscriptionId) {
            result = result.filter(a => a.subscriptionId === filters.subscriptionId);
        }
        if (filters.resourceGroupId) {
            result = result.filter(a => a.resourceGroup === filters.resourceGroupId);
        }
        if (filters.team) {
            const group = settings.teams.find(g => g.id === filters.team);
            if (group && group.values.length > 0) {
                const vals = group.values.map(v => v.toLowerCase());
                result = result.filter(a =>
                    vals.some(v => Object.values(a.tags).some(t => t.toLowerCase().includes(v)))
                );
            }
        }
        if (filters.keyword) {
            const group = settings.keywords.find(g => g.id === filters.keyword);
            if (group && group.values.length > 0) {
                const vals = group.values.map(v => v.toLowerCase());
                result = result.filter(a =>
                    vals.some(v => a.name.toLowerCase().includes(v) || a.resourceGroup.toLowerCase().includes(v))
                );
            }
        }
        if (filterTier !== 'all') {
            result = result.filter(a => a.accessTier === filterTier);
        }

        return result;
    }, [filters, settings, filterTier]);

    // ─── Sort ─────────────────────────────────────────────────────────
    const sorted = React.useMemo(() => {
        const arr = [...filtered];
        arr.sort((a, b) => {
            let va: number | string, vb: number | string;
            if (sortField === 'totalCapacity') {
                va = a.blobCapacityGB + a.fileCapacityGB + a.tableCapacityGB + a.queueCapacityGB;
                vb = b.blobCapacityGB + b.fileCapacityGB + b.tableCapacityGB + b.queueCapacityGB;
            } else if (sortField === 'monthlyCostUSD') {
                va = a.monthlyCostUSD;
                vb = b.monthlyCostUSD;
            } else if (sortField === 'accessTier') {
                va = a.accessTier;
                vb = b.accessTier;
            } else {
                va = a.name;
                vb = b.name;
            }
            if (va < vb) return sortDir === 'asc' ? -1 : 1;
            if (va > vb) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return arr;
    }, [filtered, sortField, sortDir]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortField(field); setSortDir('desc'); }
    };

    // ─── KPIs ─────────────────────────────────────────────────────────
    const totalAccounts = filtered.length;
    const totalCapacityTB = React.useMemo(
        () => filtered.reduce((s, a) => s + a.blobCapacityGB + a.fileCapacityGB + a.tableCapacityGB + a.queueCapacityGB, 0) / 1024,
        [filtered]
    );
    const totalMonthlyCost = React.useMemo(() => filtered.reduce((s, a) => s + a.monthlyCostUSD, 0), [filtered]);
    const totalEgress = React.useMemo(() => filtered.reduce((s, a) => s + a.egressGB30d, 0), [filtered]);
    const encryptedPct = React.useMemo(() => {
        if (filtered.length === 0) return 0;
        return Math.round((filtered.filter(a => a.encryption).length / filtered.length) * 100);
    }, [filtered]);
    const httpsOnlyPct = React.useMemo(() => {
        if (filtered.length === 0) return 0;
        return Math.round((filtered.filter(a => a.httpsOnly).length / filtered.length) * 100);
    }, [filtered]);

    // ─── Chart data ───────────────────────────────────────────────────
    const tierDistribution = React.useMemo(() => {
        const counts: Record<string, number> = { Hot: 0, Cool: 0, Archive: 0 };
        filtered.forEach(a => { counts[a.accessTier] = (counts[a.accessTier] || 0) + 1; });
        return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
    }, [filtered]);

    const capacityByAccount = React.useMemo(() =>
        filtered.slice(0, 10).map(a => ({
            name: a.name.length > 16 ? a.name.slice(0, 14) + '…' : a.name,
            Blob: Math.round(a.blobCapacityGB),
            File: Math.round(a.fileCapacityGB),
            Table: Math.round(a.tableCapacityGB),
            Queue: Math.round(a.queueCapacityGB),
        })),
        [filtered]
    );

    const kpis = [
        { label: 'Storage Accounts', value: totalAccounts.toString(), icon: HardDrive, color: '#3b82f6', desc: 'Total accounts matching filters' },
        { label: 'Total Capacity', value: `${totalCapacityTB.toFixed(1)} TB`, icon: Database, color: '#8b5cf6', desc: 'Combined capacity across all services' },
        { label: 'Monthly Cost', value: `$${totalMonthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: DollarSign, color: '#22c55e', desc: 'Estimated monthly storage cost' },
        { label: 'Egress (30d)', value: `${totalEgress.toLocaleString()} GB`, icon: TrendingUp, color: '#f97316', desc: 'Data egress in the last 30 days' },
        { label: 'Encrypted', value: `${encryptedPct}%`, icon: Lock, color: '#06b6d4', desc: 'Accounts with encryption enabled' },
        { label: 'HTTPS Only', value: `${httpsOnlyPct}%`, icon: httpsOnlyPct === 100 ? Lock : Unlock, color: httpsOnlyPct === 100 ? '#22c55e' : '#ef4444', desc: 'Accounts enforcing HTTPS-only access' },
    ];

    return (
        <TooltipProvider delayDuration={200}>
            <PageHeader>
                <PageHeaderHeading>Storage</PageHeaderHeading>
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
                <div className="flex items-center gap-1.5">
                    <label className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Access Tier</label>
                    <Select value={filterTier} onValueChange={setFilterTier}>
                        <SelectTrigger className="h-8 w-[120px] text-xs glass-card border-none"><SelectValue /></SelectTrigger>
                        <SelectContent className="glass-card">
                            <SelectItem value="all" className="text-xs">All Tiers</SelectItem>
                            <SelectItem value="Hot" className="text-xs">Hot</SelectItem>
                            <SelectItem value="Cool" className="text-xs">Cool</SelectItem>
                            <SelectItem value="Archive" className="text-xs">Archive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* ── KPI Cards ── */}
            {loading ? (
                <div className="flex items-center justify-center p-12 text-muted-foreground"><Database className="mr-2 animate-pulse" /> Loading storage data...</div>
            ) : (
                <>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-6 dashboard-grid-stagger">
                    {kpis.map(({ label, value, icon: Icon, color, desc }) => (
                        <Tooltip key={label}>
                            <TooltipTrigger asChild>
                                <div className="glass-card flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 hover:scale-[1.02] hover:shadow-lg transition-all duration-200 cursor-default"
                                    style={{ outline: `1px solid ${color}25` }}>
                                    <div className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}>
                                        <Icon className="size-4" style={{ color }} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
                                        <p className="text-base font-bold tabular-nums leading-none stat-glow" style={{ color }}>{value}</p>
                                    </div>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[180px]"><p>{desc}</p></TooltipContent>
                        </Tooltip>
                    ))}
                </div>

            {/* ── Charts Row ── */}
            <div className="grid gap-5 lg:grid-cols-2 mb-6">
                {/* Capacity Breakdown */}
                <Card className="glass-card gradient-border scan-line">
                    <CardHeader>
                        <CardTitle className="text-sm">Capacity Breakdown by Account</CardTitle>
                        <CardDescription>Blob, File, Table & Queue capacity (GB)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={capacityByAccount} layout="vertical" margin={{ left: 20, right: 12, top: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis type="number" tick={{ fontSize: 11 }} />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                                <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="Blob" stackId="a" fill={CAPACITY_COLORS[0]} radius={[0, 0, 0, 0]} />
                                <Bar dataKey="File" stackId="a" fill={CAPACITY_COLORS[1]} />
                                <Bar dataKey="Table" stackId="a" fill={CAPACITY_COLORS[2]} />
                                <Bar dataKey="Queue" stackId="a" fill={CAPACITY_COLORS[3]} radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Access Tier + Cost Trend */}
                <div className="flex flex-col gap-5">
                    <Card className="glass-card gradient-border scan-line">
                        <CardHeader>
                            <CardTitle className="text-sm">Access Tier Distribution</CardTitle>
                            <CardDescription>Accounts by access tier</CardDescription>
                        </CardHeader>
                        <CardContent className="flex items-center justify-center">
                            <ResponsiveContainer width="100%" height={140}>
                                <PieChart>
                                    <Pie data={tierDistribution} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                                        {tierDistribution.map(entry => (
                                            <Cell key={entry.name} fill={TIER_COLORS[entry.name] || '#94a3b8'} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="glass-card gradient-border scan-line">
                        <CardHeader>
                            <CardTitle className="text-sm">Monthly Cost Trend</CardTitle>
                            <CardDescription>Storage cost & egress over time (from FinOps data)</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {costTrendData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={120}>
                                    <LineChart data={costTrendData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                        <YAxis tick={{ fontSize: 10 }} />
                                        <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                        <Line type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={2} dot={false} name="Cost ($)" />
                                        <Line type="monotone" dataKey="egress" stroke="#f97316" strokeWidth={2} dot={false} name="Egress (GB)" />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-[120px] text-xs text-muted-foreground">
                                    No monthly cost data available yet
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* ── Accounts Table ── */}
            <Card className="glass-card gradient-border">
                <CardHeader>
                    <CardTitle className="text-sm">Storage Accounts</CardTitle>
                    <CardDescription>{sorted.length} account{sorted.length !== 1 ? 's' : ''} matching current filters</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('name')}>
                                    <div className="flex items-center gap-1">Name <ArrowUpDown className="size-3" /></div>
                                </TableHead>
                                <TableHead>Subscription</TableHead>
                                <TableHead>Region</TableHead>
                                <TableHead>Kind / Tier</TableHead>
                                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('accessTier')}>
                                    <div className="flex items-center gap-1">Access Tier <ArrowUpDown className="size-3" /></div>
                                </TableHead>
                                <TableHead>Redundancy</TableHead>
                                <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort('totalCapacity')}>
                                    <div className="flex items-center gap-1 justify-end">Capacity (GB) <ArrowUpDown className="size-3" /></div>
                                </TableHead>
                                <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort('monthlyCostUSD')}>
                                    <div className="flex items-center gap-1 justify-end">Cost/mo <ArrowUpDown className="size-3" /></div>
                                </TableHead>
                                <TableHead className="text-center">Encrypted</TableHead>
                                <TableHead className="text-center">HTTPS</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sorted.map(a => {
                                const total = a.blobCapacityGB + a.fileCapacityGB + a.tableCapacityGB + a.queueCapacityGB;
                                return (
                                    <TableRow key={a.id}>
                                        <TableCell className="font-medium font-mono text-xs">{a.name}</TableCell>
                                        <TableCell className="text-xs">{a.subscriptionName}</TableCell>
                                        <TableCell className="text-xs">{a.region}</TableCell>
                                        <TableCell className="text-xs">{a.kind} / {a.tier}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="text-[10px]" style={{ borderColor: TIER_COLORS[a.accessTier], color: TIER_COLORS[a.accessTier] }}>
                                                {a.accessTier}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs">{a.redundancy}</TableCell>
                                        <TableCell className="text-right tabular-nums text-xs">{total.toLocaleString()}</TableCell>
                                        <TableCell className="text-right tabular-nums text-xs">${a.monthlyCostUSD.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="text-center">{a.encryption ? <Lock className="size-3.5 text-emerald-500 mx-auto" /> : <Unlock className="size-3.5 text-red-500 mx-auto" />}</TableCell>
                                        <TableCell className="text-center">{a.httpsOnly ? <Lock className="size-3.5 text-emerald-500 mx-auto" /> : <Unlock className="size-3.5 text-red-500 mx-auto" />}</TableCell>
                                    </TableRow>
                                );
                            })}
                            {sorted.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">No storage accounts match the current filters</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            </>
            )}
        </TooltipProvider>
    );
}
