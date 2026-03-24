import React from 'react';
import { PageHeader, PageHeaderHeading } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { useSettings } from '@/contexts/SettingsContext';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip as RechartsTooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
    Server, Container, Cpu, MemoryStick, Play, Square, CirclePause,
    ArrowUpDown, Activity, Box,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// ─── VM Data ──────────────────────────────────────────────────────────
interface VirtualMachine {
    id: string;
    name: string;
    subscriptionId: string;
    subscriptionName: string;
    resourceGroup: string;
    region: string;
    size: string;
    sizeCategory: string;
    os: string;
    osType: 'Windows' | 'Linux';
    status: 'Running' | 'Stopped' | 'Deallocated';
    cpuPct: number;
    memoryPct: number;
    diskGB: number;
    monthlyCostUSD: number;
    publicIp: string | null;
    tags: Record<string, string>;
}

const virtualMachines: VirtualMachine[] = [
    { id: 'vm-001', name: 'prod-web-01', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-web', region: 'East US', size: 'Standard_D4s_v3', sizeCategory: 'D-Series', os: 'Ubuntu 22.04 LTS', osType: 'Linux', status: 'Running', cpuPct: 72, memoryPct: 68, diskGB: 256, monthlyCostUSD: 280.32, publicIp: '20.85.120.45', tags: { environment: 'production', team: 'platform' } },
    { id: 'vm-002', name: 'prod-web-02', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-web', region: 'East US', size: 'Standard_D4s_v3', sizeCategory: 'D-Series', os: 'Ubuntu 22.04 LTS', osType: 'Linux', status: 'Running', cpuPct: 65, memoryPct: 71, diskGB: 256, monthlyCostUSD: 280.32, publicIp: '20.85.120.46', tags: { environment: 'production', team: 'platform' } },
    { id: 'vm-003', name: 'prod-api-01', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-api', region: 'East US', size: 'Standard_E8s_v3', sizeCategory: 'E-Series', os: 'Windows Server 2022', osType: 'Windows', status: 'Running', cpuPct: 45, memoryPct: 82, diskGB: 512, monthlyCostUSD: 584.96, publicIp: null, tags: { environment: 'production', team: 'backend' } },
    { id: 'vm-004', name: 'prod-db-replica', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-data', region: 'West US 2', size: 'Standard_E16s_v3', sizeCategory: 'E-Series', os: 'Ubuntu 20.04 LTS', osType: 'Linux', status: 'Running', cpuPct: 38, memoryPct: 91, diskGB: 1024, monthlyCostUSD: 1169.92, publicIp: null, tags: { environment: 'production', team: 'data-engineering' } },
    { id: 'vm-005', name: 'prod-batch-01', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-batch', region: 'East US', size: 'Standard_F8s_v2', sizeCategory: 'F-Series', os: 'Ubuntu 22.04 LTS', osType: 'Linux', status: 'Running', cpuPct: 88, memoryPct: 42, diskGB: 128, monthlyCostUSD: 390.40, publicIp: null, tags: { environment: 'production', team: 'ml-ops' } },
    { id: 'vm-006', name: 'staging-web-01', subscriptionId: 'sub-staging-001', subscriptionName: 'Staging', resourceGroup: 'rg-staging-web', region: 'East US 2', size: 'Standard_B2ms', sizeCategory: 'B-Series', os: 'Ubuntu 22.04 LTS', osType: 'Linux', status: 'Running', cpuPct: 22, memoryPct: 35, diskGB: 64, monthlyCostUSD: 60.74, publicIp: '20.85.121.10', tags: { environment: 'staging', team: 'qa' } },
    { id: 'vm-007', name: 'dev-test-win', subscriptionId: 'sub-dev-001', subscriptionName: 'Development', resourceGroup: 'rg-dev-test', region: 'East US', size: 'Standard_D2s_v3', sizeCategory: 'D-Series', os: 'Windows 11 Enterprise', osType: 'Windows', status: 'Stopped', cpuPct: 0, memoryPct: 0, diskGB: 128, monthlyCostUSD: 140.16, publicIp: null, tags: { environment: 'development', team: 'frontend' } },
    { id: 'vm-008', name: 'dev-ml-gpu', subscriptionId: 'sub-dev-001', subscriptionName: 'Development', resourceGroup: 'rg-dev-ml', region: 'South Central US', size: 'Standard_NC6s_v3', sizeCategory: 'N-Series', os: 'Ubuntu 22.04 LTS', osType: 'Linux', status: 'Deallocated', cpuPct: 0, memoryPct: 0, diskGB: 512, monthlyCostUSD: 0, publicIp: null, tags: { environment: 'development', team: 'ml-ops' } },
    { id: 'vm-009', name: 'prod-jump-01', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-infra', region: 'East US', size: 'Standard_B1ms', sizeCategory: 'B-Series', os: 'Windows Server 2022', osType: 'Windows', status: 'Running', cpuPct: 12, memoryPct: 45, diskGB: 32, monthlyCostUSD: 15.33, publicIp: '20.85.122.100', tags: { environment: 'production', team: 'infrastructure' } },
    { id: 'vm-010', name: 'prod-monitoring', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-infra', region: 'East US', size: 'Standard_D2s_v3', sizeCategory: 'D-Series', os: 'Ubuntu 22.04 LTS', osType: 'Linux', status: 'Running', cpuPct: 55, memoryPct: 62, diskGB: 128, monthlyCostUSD: 140.16, publicIp: null, tags: { environment: 'production', team: 'infrastructure' } },
];

// ─── AKS Cluster Data ─────────────────────────────────────────────────
interface AksCluster {
    id: string;
    name: string;
    subscriptionId: string;
    subscriptionName: string;
    resourceGroup: string;
    region: string;
    version: string;
    nodeCount: number;
    podCount: number;
    podCapacity: number;
    runningPods: number;
    pendingPods: number;
    failedPods: number;
    succeededPods: number;
    cpuUtilPct: number;
    memUtilPct: number;
    health: 'Healthy' | 'Warning' | 'Critical';
    monthlyCostUSD: number;
    tags: Record<string, string>;
}

const aksClusters: AksCluster[] = [
    { id: 'aks-001', name: 'prod-aks-east', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-aks', region: 'East US', version: '1.29.2', nodeCount: 12, podCount: 186, podCapacity: 240, runningPods: 172, pendingPods: 8, failedPods: 2, succeededPods: 4, cpuUtilPct: 68, memUtilPct: 74, health: 'Healthy', monthlyCostUSD: 4250.00, tags: { environment: 'production', team: 'platform' } },
    { id: 'aks-002', name: 'prod-aks-west', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-aks', region: 'West US 2', version: '1.29.2', nodeCount: 8, podCount: 124, podCapacity: 160, runningPods: 115, pendingPods: 3, failedPods: 0, succeededPods: 6, cpuUtilPct: 55, memUtilPct: 62, health: 'Healthy', monthlyCostUSD: 2840.00, tags: { environment: 'production', team: 'platform' } },
    { id: 'aks-003', name: 'prod-ml-cluster', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-ml', region: 'East US', version: '1.28.5', nodeCount: 6, podCount: 42, podCapacity: 120, runningPods: 38, pendingPods: 2, failedPods: 1, succeededPods: 1, cpuUtilPct: 82, memUtilPct: 88, health: 'Warning', monthlyCostUSD: 5680.00, tags: { environment: 'production', team: 'ml-ops' } },
    { id: 'aks-004', name: 'staging-aks', subscriptionId: 'sub-staging-001', subscriptionName: 'Staging', resourceGroup: 'rg-staging-aks', region: 'East US 2', version: '1.29.2', nodeCount: 4, podCount: 58, podCapacity: 80, runningPods: 52, pendingPods: 4, failedPods: 0, succeededPods: 2, cpuUtilPct: 35, memUtilPct: 42, health: 'Healthy', monthlyCostUSD: 1420.00, tags: { environment: 'staging', team: 'qa' } },
    { id: 'aks-005', name: 'dev-aks-sandbox', subscriptionId: 'sub-dev-001', subscriptionName: 'Development', resourceGroup: 'rg-dev-aks', region: 'East US', version: '1.30.0', nodeCount: 3, podCount: 28, podCapacity: 60, runningPods: 22, pendingPods: 1, failedPods: 3, succeededPods: 2, cpuUtilPct: 25, memUtilPct: 30, health: 'Critical', monthlyCostUSD: 680.00, tags: { environment: 'development', team: 'frontend' } },
];

const STATUS_COLORS: Record<string, string> = {
    Running: '#22c55e', Stopped: '#f59e0b', Deallocated: '#94a3b8',
};
const HEALTH_COLORS: Record<string, string> = {
    Healthy: '#22c55e', Warning: '#f59e0b', Critical: '#ef4444',
};
const OS_COLORS = ['#3b82f6', '#f97316'];
const POD_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#94a3b8'];

type VmSortField = 'name' | 'cpuPct' | 'memoryPct' | 'monthlyCostUSD';
type AksSortField = 'name' | 'nodeCount' | 'cpuUtilPct' | 'monthlyCostUSD';

export default function VmsContainers() {
    const { filters, dispatch, availableSubscriptions } = useGlobalFilters();
    const { settings } = useSettings();
    const [vmSort, setVmSort] = React.useState<{ field: VmSortField; dir: 'asc' | 'desc' }>({ field: 'cpuPct', dir: 'desc' });
    const [aksSort, setAksSort] = React.useState<{ field: AksSortField; dir: 'asc' | 'desc' }>({ field: 'nodeCount', dir: 'desc' });
    const [statusFilter, setStatusFilter] = React.useState('all');

    // ─── Filter VMs ───────────────────────────────────────────────────
    const filteredVms = React.useMemo(() => {
        let result = virtualMachines;
        if (filters.subscriptionId) result = result.filter(v => v.subscriptionId === filters.subscriptionId);
        if (filters.resourceGroupId) result = result.filter(v => v.resourceGroup === filters.resourceGroupId);
        if (filters.team) {
            const group = settings.teams.find(g => g.id === filters.team);
            if (group?.values.length) {
                const vals = group.values.map(v => v.toLowerCase());
                result = result.filter(v => vals.some(val => Object.values(v.tags).some(t => t.toLowerCase().includes(val))));
            }
        }
        if (statusFilter !== 'all') result = result.filter(v => v.status === statusFilter);
        return result;
    }, [filters, settings, statusFilter]);

    const sortedVms = React.useMemo(() => {
        const arr = [...filteredVms];
        arr.sort((a, b) => {
            const va = a[vmSort.field] as number | string;
            const vb = b[vmSort.field] as number | string;
            if (va < vb) return vmSort.dir === 'asc' ? -1 : 1;
            if (va > vb) return vmSort.dir === 'asc' ? 1 : -1;
            return 0;
        });
        return arr;
    }, [filteredVms, vmSort]);

    const toggleVmSort = (field: VmSortField) => {
        setVmSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' });
    };

    // ─── Filter AKS ───────────────────────────────────────────────────
    const filteredAks = React.useMemo(() => {
        let result = aksClusters;
        if (filters.subscriptionId) result = result.filter(c => c.subscriptionId === filters.subscriptionId);
        if (filters.resourceGroupId) result = result.filter(c => c.resourceGroup === filters.resourceGroupId);
        if (filters.team) {
            const group = settings.teams.find(g => g.id === filters.team);
            if (group?.values.length) {
                const vals = group.values.map(v => v.toLowerCase());
                result = result.filter(c => vals.some(val => Object.values(c.tags).some(t => t.toLowerCase().includes(val))));
            }
        }
        return result;
    }, [filters, settings]);

    const sortedAks = React.useMemo(() => {
        const arr = [...filteredAks];
        arr.sort((a, b) => {
            const va = a[aksSort.field] as number | string;
            const vb = b[aksSort.field] as number | string;
            if (va < vb) return aksSort.dir === 'asc' ? -1 : 1;
            if (va > vb) return aksSort.dir === 'asc' ? 1 : -1;
            return 0;
        });
        return arr;
    }, [filteredAks, aksSort]);

    const toggleAksSort = (field: AksSortField) => {
        setAksSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' });
    };

    // ─── VM KPIs ──────────────────────────────────────────────────────
    const vmRunning = filteredVms.filter(v => v.status === 'Running').length;
    const vmStopped = filteredVms.filter(v => v.status === 'Stopped').length;
    const vmDealloc = filteredVms.filter(v => v.status === 'Deallocated').length;
    const avgCpu = filteredVms.filter(v => v.status === 'Running').length > 0
        ? Math.round(filteredVms.filter(v => v.status === 'Running').reduce((s, v) => s + v.cpuPct, 0) / filteredVms.filter(v => v.status === 'Running').length) : 0;
    const avgMem = filteredVms.filter(v => v.status === 'Running').length > 0
        ? Math.round(filteredVms.filter(v => v.status === 'Running').reduce((s, v) => s + v.memoryPct, 0) / filteredVms.filter(v => v.status === 'Running').length) : 0;
    const vmTotalCost = filteredVms.reduce((s, v) => s + v.monthlyCostUSD, 0);

    // ─── AKS KPIs ─────────────────────────────────────────────────────
    const aksNodes = filteredAks.reduce((s, c) => s + c.nodeCount, 0);
    const aksPods = filteredAks.reduce((s, c) => s + c.podCount, 0);
    const aksHealthy = filteredAks.filter(c => c.health === 'Healthy').length;
    const aksTotalCost = filteredAks.reduce((s, c) => s + c.monthlyCostUSD, 0);

    // ─── Chart data ───────────────────────────────────────────────────
    const osDistribution = React.useMemo(() => {
        const linux = filteredVms.filter(v => v.osType === 'Linux').length;
        const windows = filteredVms.filter(v => v.osType === 'Windows').length;
        return [{ name: 'Linux', value: linux }, { name: 'Windows', value: windows }].filter(d => d.value > 0);
    }, [filteredVms]);

    const sizeDistribution = React.useMemo(() => {
        const counts: Record<string, number> = {};
        filteredVms.forEach(v => { counts[v.sizeCategory] = (counts[v.sizeCategory] || 0) + 1; });
        return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    }, [filteredVms]);

    const podStatusData = React.useMemo(() => {
        const running = filteredAks.reduce((s, c) => s + c.runningPods, 0);
        const pending = filteredAks.reduce((s, c) => s + c.pendingPods, 0);
        const failed = filteredAks.reduce((s, c) => s + c.failedPods, 0);
        const succeeded = filteredAks.reduce((s, c) => s + c.succeededPods, 0);
        return [
            { name: 'Running', value: running },
            { name: 'Pending', value: pending },
            { name: 'Failed', value: failed },
            { name: 'Succeeded', value: succeeded },
        ].filter(d => d.value > 0);
    }, [filteredAks]);

    const clusterUtilData = React.useMemo(() =>
        filteredAks.map(c => ({
            name: c.name.length > 14 ? c.name.slice(0, 12) + '…' : c.name,
            CPU: c.cpuUtilPct,
            Memory: c.memUtilPct,
        })),
        [filteredAks]
    );

    const vmKpis = [
        { label: 'Total VMs', value: filteredVms.length.toString(), icon: Server, color: '#3b82f6' },
        { label: 'Running', value: vmRunning.toString(), icon: Play, color: '#22c55e' },
        { label: 'Stopped', value: vmStopped.toString(), icon: Square, color: '#f59e0b' },
        { label: 'Deallocated', value: vmDealloc.toString(), icon: CirclePause, color: '#94a3b8' },
        { label: 'Avg CPU', value: `${avgCpu}%`, icon: Cpu, color: avgCpu > 80 ? '#ef4444' : '#06b6d4' },
        { label: 'Avg Memory', value: `${avgMem}%`, icon: MemoryStick, color: avgMem > 80 ? '#ef4444' : '#8b5cf6' },
    ];

    const aksKpis = [
        { label: 'Clusters', value: filteredAks.length.toString(), icon: Container, color: '#3b82f6' },
        { label: 'Total Nodes', value: aksNodes.toString(), icon: Box, color: '#8b5cf6' },
        { label: 'Total Pods', value: aksPods.toString(), icon: Activity, color: '#06b6d4' },
        { label: 'Healthy', value: `${aksHealthy}/${filteredAks.length}`, icon: Activity, color: '#22c55e' },
    ];

    const UtilBar = ({ pct, color }: { pct: number; color: string }) => (
        <div className="flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} /></div>
            <span className="text-[11px] tabular-nums font-semibold w-8 text-right" style={{ color }}>{pct}%</span>
        </div>
    );

    return (
        <TooltipProvider delayDuration={200}>
            <PageHeader>
                <PageHeaderHeading>VMs & Containers</PageHeaderHeading>
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
            </div>

            <Tabs defaultValue="vms" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="vms" className="flex items-center gap-2"><Server className="h-4 w-4" />Virtual Machines</TabsTrigger>
                    <TabsTrigger value="containers" className="flex items-center gap-2"><Container className="h-4 w-4" />AKS Clusters</TabsTrigger>
                </TabsList>

                {/* ═══ VMs Tab ═══ */}
                <TabsContent value="vms" className="space-y-6">
                    {/* KPIs */}
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 dashboard-grid-stagger">
                        {vmKpis.map(({ label, value, icon: Icon, color }) => (
                            <div key={label} className="glass-card flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 hover:scale-[1.02] transition-all duration-200" style={{ outline: `1px solid ${color}25` }}>
                                <div className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}><Icon className="size-4" style={{ color }} /></div>
                                <div><p className="text-[10px] text-muted-foreground font-medium">{label}</p><p className="text-base font-bold tabular-nums leading-none stat-glow" style={{ color }}>{value}</p></div>
                            </div>
                        ))}
                    </div>

                    {/* Charts */}
                    <div className="grid gap-5 lg:grid-cols-2">
                        <Card className="glass-card gradient-border scan-line">
                            <CardHeader><CardTitle className="text-sm">OS Distribution</CardTitle><CardDescription>VMs by operating system</CardDescription></CardHeader>
                            <CardContent className="flex items-center justify-center">
                                <ResponsiveContainer width="100%" height={200}>
                                    <PieChart>
                                        <Pie data={osDistribution} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                                            {osDistribution.map((_, i) => <Cell key={i} fill={OS_COLORS[i % OS_COLORS.length]} />)}
                                        </Pie>
                                        <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                        <Card className="glass-card gradient-border scan-line">
                            <CardHeader><CardTitle className="text-sm">VM Size Categories</CardTitle><CardDescription>Distribution by Azure VM series</CardDescription></CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={200}>
                                    <BarChart data={sizeDistribution} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                        <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                        <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="VMs" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    {/* VM Table */}
                    <Card className="glass-card gradient-border">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div><CardTitle className="text-sm">Virtual Machines</CardTitle><CardDescription>{sortedVms.length} VM{sortedVms.length !== 1 ? 's' : ''} • Total: ${vmTotalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo</CardDescription></div>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="h-8 w-[130px] text-xs glass-card border-none"><SelectValue /></SelectTrigger>
                                    <SelectContent className="glass-card">
                                        <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
                                        <SelectItem value="Running" className="text-xs">Running</SelectItem>
                                        <SelectItem value="Stopped" className="text-xs">Stopped</SelectItem>
                                        <SelectItem value="Deallocated" className="text-xs">Deallocated</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="cursor-pointer select-none" onClick={() => toggleVmSort('name')}><div className="flex items-center gap-1">Name <ArrowUpDown className="size-3" /></div></TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Region</TableHead>
                                        <TableHead>Size</TableHead>
                                        <TableHead>OS</TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => toggleVmSort('cpuPct')}><div className="flex items-center gap-1">CPU <ArrowUpDown className="size-3" /></div></TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => toggleVmSort('memoryPct')}><div className="flex items-center gap-1">Memory <ArrowUpDown className="size-3" /></div></TableHead>
                                        <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleVmSort('monthlyCostUSD')}><div className="flex items-center gap-1 justify-end">Cost/mo <ArrowUpDown className="size-3" /></div></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedVms.map(v => (
                                        <TableRow key={v.id}>
                                            <TableCell className="font-medium font-mono text-xs">{v.name}</TableCell>
                                            <TableCell><Badge variant="outline" className="text-[10px]" style={{ borderColor: STATUS_COLORS[v.status], color: STATUS_COLORS[v.status] }}>{v.status}</Badge></TableCell>
                                            <TableCell className="text-xs">{v.region}</TableCell>
                                            <TableCell className="text-xs font-mono">{v.size}</TableCell>
                                            <TableCell className="text-xs">{v.os}</TableCell>
                                            <TableCell className="w-32"><UtilBar pct={v.cpuPct} color={v.cpuPct > 80 ? '#ef4444' : '#06b6d4'} /></TableCell>
                                            <TableCell className="w-32"><UtilBar pct={v.memoryPct} color={v.memoryPct > 80 ? '#ef4444' : '#8b5cf6'} /></TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">${v.monthlyCostUSD.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                        </TableRow>
                                    ))}
                                    {sortedVms.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No VMs match the current filters</TableCell></TableRow>}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══ Containers Tab ═══ */}
                <TabsContent value="containers" className="space-y-6">
                    {/* KPIs */}
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4 dashboard-grid-stagger">
                        {aksKpis.map(({ label, value, icon: Icon, color }) => (
                            <div key={label} className="glass-card flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 hover:scale-[1.02] transition-all duration-200" style={{ outline: `1px solid ${color}25` }}>
                                <div className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}><Icon className="size-4" style={{ color }} /></div>
                                <div><p className="text-[10px] text-muted-foreground font-medium">{label}</p><p className="text-base font-bold tabular-nums leading-none stat-glow" style={{ color }}>{value}</p></div>
                            </div>
                        ))}
                    </div>

                    {/* Charts */}
                    <div className="grid gap-5 lg:grid-cols-2">
                        <Card className="glass-card gradient-border scan-line">
                            <CardHeader><CardTitle className="text-sm">Pod Status Distribution</CardTitle><CardDescription>Across all clusters</CardDescription></CardHeader>
                            <CardContent className="flex items-center justify-center">
                                <ResponsiveContainer width="100%" height={200}>
                                    <PieChart>
                                        <Pie data={podStatusData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                                            {podStatusData.map((_, i) => <Cell key={i} fill={POD_COLORS[i % POD_COLORS.length]} />)}
                                        </Pie>
                                        <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                        <Card className="glass-card gradient-border scan-line">
                            <CardHeader><CardTitle className="text-sm">Cluster Utilization</CardTitle><CardDescription>CPU & Memory utilization per cluster</CardDescription></CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={200}>
                                    <BarChart data={clusterUtilData} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                                        <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                        <Bar dataKey="CPU" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="Memory" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    {/* AKS Table */}
                    <Card className="glass-card gradient-border">
                        <CardHeader>
                            <CardTitle className="text-sm">AKS Clusters</CardTitle>
                            <CardDescription>{sortedAks.length} cluster{sortedAks.length !== 1 ? 's' : ''} • Total: ${aksTotalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo</CardDescription>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="cursor-pointer select-none" onClick={() => toggleAksSort('name')}><div className="flex items-center gap-1">Cluster <ArrowUpDown className="size-3" /></div></TableHead>
                                        <TableHead>Health</TableHead>
                                        <TableHead>Version</TableHead>
                                        <TableHead>Region</TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => toggleAksSort('nodeCount')}><div className="flex items-center gap-1">Nodes <ArrowUpDown className="size-3" /></div></TableHead>
                                        <TableHead>Pods</TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => toggleAksSort('cpuUtilPct')}><div className="flex items-center gap-1">CPU <ArrowUpDown className="size-3" /></div></TableHead>
                                        <TableHead>Memory</TableHead>
                                        <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleAksSort('monthlyCostUSD')}><div className="flex items-center gap-1 justify-end">Cost/mo <ArrowUpDown className="size-3" /></div></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedAks.map(c => (
                                        <TableRow key={c.id}>
                                            <TableCell className="font-medium font-mono text-xs">{c.name}</TableCell>
                                            <TableCell><Badge variant="outline" className="text-[10px]" style={{ borderColor: HEALTH_COLORS[c.health], color: HEALTH_COLORS[c.health] }}>{c.health}</Badge></TableCell>
                                            <TableCell className="text-xs font-mono">{c.version}</TableCell>
                                            <TableCell className="text-xs">{c.region}</TableCell>
                                            <TableCell className="text-xs tabular-nums">{c.nodeCount}</TableCell>
                                            <TableCell className="text-xs tabular-nums">{c.runningPods}/{c.podCapacity}</TableCell>
                                            <TableCell className="w-28"><UtilBar pct={c.cpuUtilPct} color={c.cpuUtilPct > 80 ? '#ef4444' : '#06b6d4'} /></TableCell>
                                            <TableCell className="w-28"><UtilBar pct={c.memUtilPct} color={c.memUtilPct > 80 ? '#ef4444' : '#8b5cf6'} /></TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">${c.monthlyCostUSD.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                        </TableRow>
                                    ))}
                                    {sortedAks.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No AKS clusters match the current filters</TableCell></TableRow>}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </TooltipProvider>
    );
}
