import React from "react";
import { Building2, ShieldCheck, CircleCheckBig, Server, Container, Database, Network, CircleDollarSign, Activity } from "lucide-react";

import {
    PolarAngleAxis,
    RadialBar,
    RadialBarChart,
} from "recharts"



import {
    ChartContainer,
} from "@/components/ui/chart"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
// import { Separator } from "@/components/ui/separator"
import { useGlobalFilters } from "@/contexts/GlobalFilterContext";
import { GlobalFilters } from "@/components/GlobalFilters";

import { formatNumber } from "@/lib/format-utils";
import { OverviewCards } from "@/components/overview-cards";
import { fetchVmsContainers, fetchNetworks, fetchStorageAccounts, fetchFinOps } from "@/services/blobService";

export default function Dashboard() {
    const [totalVms, setTotalVms] = React.useState<number>(0);
    const [totalAks, setTotalAks] = React.useState<number>(0);
    const [totalStorage, setTotalStorage] = React.useState<number>(0);
    const [totalVnets, setTotalVnets] = React.useState<number>(0);
    const [monthlyCost, setMonthlyCost] = React.useState<number>(0);
    const [loadingMetrics, setLoadingMetrics] = React.useState<boolean>(true);

    const { reportData, filteredTests, availableTenants, availableSubscriptions, availableDates, filters, dispatch } = useGlobalFilters();

    React.useEffect(() => {
        if (!filters.tenantId || availableSubscriptions.length === 0 || availableDates.length === 0) {
            setTotalVms(0); setTotalAks(0); setTotalStorage(0); setTotalVnets(0); setMonthlyCost(0);
            setLoadingMetrics(false);
            return;
        }
        let cancelled = false;
        
        let targetSubs = availableSubscriptions;
        if (filters.subscriptionId) {
            targetSubs = targetSubs.filter(s => s.id === filters.subscriptionId);
        }

        const vmTasks = targetSubs.map(sub => fetchVmsContainers(filters.tenantId, sub.id, 'latest').catch(() => null));
        const netTasks = targetSubs.map(sub => fetchNetworks(filters.tenantId, sub.id, 'latest').catch(() => null));
        const storageTasks = targetSubs.map(sub => fetchStorageAccounts(filters.tenantId, sub.id, 'latest').catch(() => null));
        const finopsTasks = targetSubs.map(sub => fetchFinOps(filters.tenantId, sub.id, 'latest').catch(() => null));

        Promise.all([
            Promise.all(vmTasks),
            Promise.all(netTasks),
            Promise.all(storageTasks),
            Promise.all(finopsTasks)
        ]).then(([vmResults, netResults, storageResults, finopsResults]) => {
            if (cancelled) return;
            
            const vms = vmResults.flatMap(r => r?.virtualMachines ?? []).length;
            const aks = vmResults.flatMap(r => r?.aksClusters ?? []).length;
            const nets = netResults.flatMap(r => r?.vnets ?? []).length;
            const storage = storageResults.flatMap(r => r?.accounts ?? []).length;
            
            const costs = finopsResults.flatMap(r => r?.subscriptionCosts ?? []);
            const monthCost = costs.reduce((s, c) => s + (c.currentMonth || 0), 0);
            
            setTotalVms(vms);
            setTotalAks(aks);
            setTotalVnets(nets);
            setTotalStorage(storage);
            setMonthlyCost(monthCost);
            setLoadingMetrics(false);
        });

        return () => { cancelled = true; };
    }, [filters.tenantId, filters.subscriptionId, availableSubscriptions, availableDates]);

    const formatCurrency = (val: number) => {
        if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
        return `$${Math.round(val)}`;
    };

    const tenantMetrics = React.useMemo(() => [
        { label: 'Total VMs', value: loadingMetrics ? '...' : totalVms, icon: Server, color: '#3b82f6', bg: 'from-blue-500/15 to-blue-500/5', ring: '#3b82f625', desc: 'Total number of virtual machines across scope' },
        { label: 'AKS Clusters', value: loadingMetrics ? '...' : totalAks, icon: Container, color: '#8b5cf6', bg: 'from-violet-500/15 to-violet-500/5', ring: '#8b5cf625', desc: 'Total number of Azure Kubernetes Service clusters' },
        { label: 'Storage Accounts', value: loadingMetrics ? '...' : totalStorage, icon: Database, color: '#a855f7', bg: 'from-purple-500/15 to-purple-500/5', ring: '#a855f725', desc: 'Total number of Azure Storage Accounts' },
        { label: 'Virtual Networks', value: loadingMetrics ? '...' : totalVnets, icon: Network, color: '#ec4899', bg: 'from-pink-500/15 to-pink-500/5', ring: '#ec489925', desc: 'Total number of VNets deployed' },
        { label: 'Monthly Cost', value: loadingMetrics ? '...' : formatCurrency(monthlyCost), icon: CircleDollarSign, color: '#f97316', bg: 'from-orange-500/15 to-orange-500/5', ring: '#f9731625', desc: 'Aggregated monthly cloud spend' },
        { label: 'Environments', value: availableSubscriptions.length, icon: Activity, color: '#22c55e', bg: 'from-emerald-500/15 to-emerald-500/5', ring: '#22c55e25', desc: 'Total active subscriptions matching filters' },
    ], [totalVms, totalAks, totalStorage, totalVnets, monthlyCost, loadingMetrics, availableSubscriptions.length]);

    const tenantDetails = React.useMemo(() => [
        { label: 'Tenant ID', value: reportData.TenantId || 'Not Available', mono: true },
        { label: 'Primary Domain', value: reportData.Domain || 'Not Available', mono: false },
    ], [reportData.TenantId, reportData.Domain]);

    // Compute filtered assessment summary from filteredTests
    const assessmentSummary = React.useMemo(() => {
        const byPillar: Record<string, { passed: number; total: number }> = {};

        filteredTests.forEach(t => {
            const pillar = t.TestPillar ?? 'Other';
            if (!byPillar[pillar]) byPillar[pillar] = { passed: 0, total: 0 };
            byPillar[pillar].total++;
            if (t.TestStatus === 'Passed') byPillar[pillar].passed++;
        });

        return byPillar;
    }, [filteredTests]);

    const totalPassed = React.useMemo(() =>
        Object.values(assessmentSummary).reduce((s, p) => s + p.passed, 0),
        [assessmentSummary]
    );
    const totalTests = React.useMemo(() =>
        Object.values(assessmentSummary).reduce((s, p) => s + p.total, 0),
        [assessmentSummary]
    );

    const pillarColors: Record<string, string> = {
    'Storage': 'hsl(var(--chart-1))',
    'VMs & Containers': 'hsl(var(--chart-2))',
    'Networks': 'hsl(var(--chart-3))',
    'FinOps': 'hsl(var(--chart-4))',
    'Trends': 'hsl(var(--chart-5))',
};

    const pillarEntries = React.useMemo(() =>
        Object.entries(assessmentSummary).map(([label, { passed, total }]) => ({
            label,
            passed,
            total,
            color: pillarColors[label] ?? 'hsl(var(--chart-5))',
        })),
        [assessmentSummary]
    );

    const hasMultipleTenants = availableTenants.length > 1;

    return (
        <>
            {/* ── Global Filter Bar ── */}
            <div className="-mx-4 md:-mx-8">
                <GlobalFilters />
            </div>
            
            <TooltipProvider delayDuration={200}>
                {/* ── Hero: Tenant / Metrics / Assessment ── */}
                <div className="w-full flex max-w-7xl flex-col gap-6 mt-6">
                    <div className="grid w-full gap-5 lg:grid-cols-3">

                    {/* ── Tenant Info Card ── */}
                    <div className="glass-card gradient-border scan-line p-6 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 ring-1 ring-blue-500/20">
                                <Building2 className="size-5 text-blue-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tenant</p>
                                {hasMultipleTenants ? (
                                    <Select
                                        value={filters.tenantId}
                                        onValueChange={(v) => dispatch({ type: 'SET_TENANT', tenantId: v })}
                                    >
                                        <SelectTrigger className="h-8 w-full text-sm font-bold border-none bg-transparent hover:bg-muted/50 transition-colors p-0 shadow-none focus:ring-0">
                                            <SelectValue placeholder="Select tenant..." />
                                        </SelectTrigger>
                                        <SelectContent className="glass-card">
                                            {availableTenants.map((t) => (
                                                <SelectItem key={t.id} value={t.id} className="text-sm">
                                                    {t.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <h2 className="text-lg font-bold leading-tight">{reportData.TenantName || 'Your Tenant'}</h2>
                                )}
                            </div>
                        </div>
                        <div className="space-y-3">
                            {tenantDetails.map(({ label, value, mono }) => (
                                <div key={label} className="flex items-start gap-3">
                                    <div className="w-28 shrink-0">
                                        <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
                                    </div>
                                    <div className={`flex-1 min-w-0 text-sm font-semibold truncate ${mono ? 'font-mono text-xs text-muted-foreground' : ''}`}>
                                        {value}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Tenant-wide summary badge */}
                        <div className="mt-auto pt-2 border-t border-border/30">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Tenant Assessment</span>
                                <span className="font-bold tabular-nums text-foreground">
                                    {totalPassed}/{totalTests} passed
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* ── Tenant Metrics Grid ── */}
                    <div className="grid gap-3 grid-cols-2 grid-rows-3">
                        {tenantMetrics.map(({ label, value, icon: Icon, color, bg, ring, desc }) => (
                            <Tooltip key={label}>
                                <TooltipTrigger asChild>
                                    <div tabIndex={0} aria-label={`${label}: ${value}`} className={`glass-card flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-br ${bg} border border-border/60 hover:scale-[1.02] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-all duration-200 cursor-default`}
                                        style={{ outline: `1px solid ${ring}` }}>
                                        <div className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}>
                                            <Icon className="size-4" style={{ color }} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
                                            <p className="text-lg font-bold tabular-nums leading-none stat-glow" style={{ color }}>
                                                {typeof value === 'number' ? formatNumber(value) : value}
                                            </p>
                                        </div>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs max-w-[180px]">
                                    <p className="font-semibold">{value?.toLocaleString() ?? '0'} {label}</p>
                                    <p className="text-muted-foreground mt-0.5">{desc}</p>
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </div>

                    {/* ── Assessment Results Card ── */}
                    <div className="glass-card gradient-border scan-line p-6 flex flex-col gap-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 ring-1 ring-emerald-500/20">
                                <ShieldCheck className="size-5 text-emerald-500" />
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Assessment</p>
                                <h2 className="text-lg font-bold leading-tight">Security Tests</h2>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            {/* Radial Chart */}
                            <div className="relative shrink-0 w-28 h-28">
                                <ChartContainer
                                    config={{
                                        move: { label: 'Identity', color: 'hsl(var(--chart-1))' },
                                        exercise: { label: 'Devices', color: 'hsl(var(--chart-2))' },
                                        stand: { label: 'Data', color: 'hsl(var(--chart-3))' },
                                        network: { label: 'Network', color: 'hsl(var(--chart-4))' },
                                    }}
                                    className="w-full h-full"
                                >
                                    <RadialBarChart
                                        margin={{ left: -10, right: -10, top: -10, bottom: -10 }}
                                        data={pillarEntries
                                            .filter(e => e.total > 0)
                                            .map((e) => ({
                                                activity: e.label.toLowerCase(),
                                                value: (e.passed / e.total) * 100,
                                                fill: e.color,
                                            }))}
                                        innerRadius="20%" barSize={20} startAngle={90} endAngle={450}
                                    >
                                        <PolarAngleAxis type="number" domain={[0, 100]} dataKey="value" tick={false} />
                                        <RadialBar dataKey="value" background cornerRadius={4} />
                                    </RadialBarChart>
                                </ChartContainer>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <CircleCheckBig className="size-7 text-emerald-500 opacity-80" />
                                </div>
                            </div>

                            {/* Pillar breakdown */}
                            <div className="flex-1 space-y-2.5">
                                {pillarEntries.filter(e => e.total > 0).map(({ label, passed, total, color }) => {
                                    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
                                    return (
                                        <div key={label} className="space-y-1">
                                            <div className="flex justify-between text-xs">
                                                <span className="text-muted-foreground font-medium">{label}</span>
                                                <span className="font-bold tabular-nums" style={{ color }}>
                                                    {passed}/{total}
                                                </span>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
                                                    style={{ width: `${pct}%`, background: color }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                                {pillarEntries.filter(e => e.total > 0).length === 0 && (
                                    <p className="text-xs text-muted-foreground italic">No tests match current filters</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Security Posture Overview Cards ── */}
            <OverviewCards />

        </TooltipProvider>
        </>
    );
}
