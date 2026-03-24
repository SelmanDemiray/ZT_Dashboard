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
    AreaChart, Area, Legend,
} from 'recharts';
import {
    Globe, Shield, Wifi, Router, ArrowUpDown, ShieldCheck,
    ShieldAlert, Lock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// ─── Network Data Types ───────────────────────────────────────────────
interface VNet {
    id: string;
    name: string;
    subscriptionId: string;
    subscriptionName: string;
    resourceGroup: string;
    region: string;
    addressSpace: string;
    subnetCount: number;
    peeredWith: string[];
    dnsServers: string;
    ddosProtection: boolean;
    tags: Record<string, string>;
}

interface NSG {
    id: string;
    name: string;
    subscriptionId: string;
    resourceGroup: string;
    region: string;
    allowRules: number;
    denyRules: number;
    subnetsAttached: number;
    nicsAttached: number;
    highRiskPorts: string[];
    defaultDeny: boolean;
}

interface Firewall {
    id: string;
    name: string;
    subscriptionId: string;
    resourceGroup: string;
    region: string;
    tier: string;
    status: 'Running' | 'Stopped';
    ruleCollections: number;
    threatIntelMode: string;
    monthlyCostUSD: number;
}

interface LoadBalancer {
    id: string;
    name: string;
    subscriptionId: string;
    resourceGroup: string;
    region: string;
    sku: string;
    type: 'Public' | 'Internal';
    backendPools: number;
    healthProbes: number;
    rules: number;
}

const vnets: VNet[] = [
    { id: 'vn-001', name: 'vnet-prod-east', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-network', region: 'East US', addressSpace: '10.0.0.0/16', subnetCount: 8, peeredWith: ['vnet-prod-west', 'vnet-hub-east'], dnsServers: 'Azure DNS', ddosProtection: true, tags: { environment: 'production', team: 'infrastructure' } },
    { id: 'vn-002', name: 'vnet-prod-west', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-network', region: 'West US 2', addressSpace: '10.1.0.0/16', subnetCount: 6, peeredWith: ['vnet-prod-east', 'vnet-hub-west'], dnsServers: 'Azure DNS', ddosProtection: true, tags: { environment: 'production', team: 'infrastructure' } },
    { id: 'vn-003', name: 'vnet-hub-east', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-hub', region: 'East US', addressSpace: '10.100.0.0/20', subnetCount: 4, peeredWith: ['vnet-prod-east', 'vnet-staging-east'], dnsServers: 'Custom (10.100.0.10, 10.100.0.11)', ddosProtection: true, tags: { environment: 'production', team: 'infrastructure' } },
    { id: 'vn-004', name: 'vnet-staging-east', subscriptionId: 'sub-staging-001', subscriptionName: 'Staging', resourceGroup: 'rg-staging-network', region: 'East US 2', addressSpace: '10.2.0.0/16', subnetCount: 4, peeredWith: ['vnet-hub-east'], dnsServers: 'Azure DNS', ddosProtection: false, tags: { environment: 'staging', team: 'qa' } },
    { id: 'vn-005', name: 'vnet-dev-east', subscriptionId: 'sub-dev-001', subscriptionName: 'Development', resourceGroup: 'rg-dev-network', region: 'East US', addressSpace: '10.3.0.0/16', subnetCount: 3, peeredWith: [], dnsServers: 'Azure DNS', ddosProtection: false, tags: { environment: 'development', team: 'frontend' } },
    { id: 'vn-006', name: 'vnet-dmz-east', subscriptionId: 'sub-prod-001', subscriptionName: 'Production', resourceGroup: 'rg-prod-dmz', region: 'East US', addressSpace: '10.200.0.0/24', subnetCount: 2, peeredWith: ['vnet-hub-east'], dnsServers: 'Custom (10.100.0.10)', ddosProtection: true, tags: { environment: 'production', team: 'security' } },
];

const nsgs: NSG[] = [
    { id: 'nsg-001', name: 'nsg-prod-web', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-web', region: 'East US', allowRules: 12, denyRules: 8, subnetsAttached: 2, nicsAttached: 4, highRiskPorts: [], defaultDeny: true },
    { id: 'nsg-002', name: 'nsg-prod-api', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-api', region: 'East US', allowRules: 6, denyRules: 5, subnetsAttached: 1, nicsAttached: 3, highRiskPorts: [], defaultDeny: true },
    { id: 'nsg-003', name: 'nsg-prod-data', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-data', region: 'East US', allowRules: 4, denyRules: 6, subnetsAttached: 1, nicsAttached: 2, highRiskPorts: [], defaultDeny: true },
    { id: 'nsg-004', name: 'nsg-staging-web', subscriptionId: 'sub-staging-001', resourceGroup: 'rg-staging-web', region: 'East US 2', allowRules: 8, denyRules: 3, subnetsAttached: 1, nicsAttached: 2, highRiskPorts: ['22', '3389'], defaultDeny: false },
    { id: 'nsg-005', name: 'nsg-dev-open', subscriptionId: 'sub-dev-001', resourceGroup: 'rg-dev-network', region: 'East US', allowRules: 15, denyRules: 1, subnetsAttached: 3, nicsAttached: 5, highRiskPorts: ['22', '3389', '445'], defaultDeny: false },
    { id: 'nsg-006', name: 'nsg-prod-dmz', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-dmz', region: 'East US', allowRules: 3, denyRules: 12, subnetsAttached: 2, nicsAttached: 2, highRiskPorts: [], defaultDeny: true },
    { id: 'nsg-007', name: 'nsg-prod-aks', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-aks', region: 'East US', allowRules: 18, denyRules: 10, subnetsAttached: 2, nicsAttached: 12, highRiskPorts: [], defaultDeny: true },
];

const firewalls: Firewall[] = [
    { id: 'fw-001', name: 'fw-hub-east', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-hub', region: 'East US', tier: 'Premium', status: 'Running', ruleCollections: 24, threatIntelMode: 'Alert & Deny', monthlyCostUSD: 1825.00 },
    { id: 'fw-002', name: 'fw-hub-west', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-hub', region: 'West US 2', tier: 'Standard', status: 'Running', ruleCollections: 18, threatIntelMode: 'Alert', monthlyCostUSD: 912.50 },
];

const loadBalancers: LoadBalancer[] = [
    { id: 'lb-001', name: 'lb-prod-web', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-web', region: 'East US', sku: 'Standard', type: 'Public', backendPools: 2, healthProbes: 3, rules: 5 },
    { id: 'lb-002', name: 'lb-prod-api-internal', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-api', region: 'East US', sku: 'Standard', type: 'Internal', backendPools: 1, healthProbes: 2, rules: 3 },
    { id: 'lb-003', name: 'lb-prod-web-west', subscriptionId: 'sub-prod-001', resourceGroup: 'rg-prod-web', region: 'West US 2', sku: 'Standard', type: 'Public', backendPools: 2, healthProbes: 3, rules: 4 },
    { id: 'lb-004', name: 'lb-staging', subscriptionId: 'sub-staging-001', resourceGroup: 'rg-staging-web', region: 'East US 2', sku: 'Basic', type: 'Public', backendPools: 1, healthProbes: 1, rules: 2 },
];

const trafficData = [
    { time: 'Week 1', inbound: 4200, outbound: 3800 },
    { time: 'Week 2', inbound: 4500, outbound: 4100 },
    { time: 'Week 3', inbound: 5100, outbound: 4600 },
    { time: 'Week 4', inbound: 4800, outbound: 4400 },
    { time: 'Week 5', inbound: 5400, outbound: 5000 },
    { time: 'Week 6', inbound: 5800, outbound: 5200 },
    { time: 'Week 7', inbound: 6200, outbound: 5600 },
    { time: 'Week 8', inbound: 5900, outbound: 5400 },
];

export default function Networks() {
    const { filters, dispatch, availableSubscriptions } = useGlobalFilters();
    const { settings } = useSettings();
    const [vnetSort, setVnetSort] = React.useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'subnetCount', dir: 'desc' });

    // ─── Filtering ────────────────────────────────────────────────────
    const applySubFilter = <T extends { subscriptionId: string }>(arr: T[]) => {
        let result = arr;
        if (filters.subscriptionId) result = result.filter(r => r.subscriptionId === filters.subscriptionId);
        return result;
    };

    const applyTagFilter = <T extends { tags?: Record<string, string> }>(arr: T[]) => {
        let result = arr;
        if (filters.team) {
            const group = settings.teams.find(g => g.id === filters.team);
            if (group?.values.length) {
                const vals = group.values.map(v => v.toLowerCase());
                result = result.filter(r => r.tags && vals.some(v => Object.values(r.tags!).some(t => t.toLowerCase().includes(v))));
            }
        }
        return result;
    };

    const filteredVnets = React.useMemo(() => applyTagFilter(applySubFilter(vnets)), [filters, settings]);
    const filteredNsgs = React.useMemo(() => applySubFilter(nsgs), [filters]);
    const filteredFws = React.useMemo(() => applySubFilter(firewalls), [filters]);
    const filteredLbs = React.useMemo(() => applySubFilter(loadBalancers), [filters]);

    const sortedVnets = React.useMemo(() => {
        const arr = [...filteredVnets];
        arr.sort((a, b) => {
            const key = vnetSort.field as keyof VNet;
            const va = a[key] as number | string;
            const vb = b[key] as number | string;
            if (va < vb) return vnetSort.dir === 'asc' ? -1 : 1;
            if (va > vb) return vnetSort.dir === 'asc' ? 1 : -1;
            return 0;
        });
        return arr;
    }, [filteredVnets, vnetSort]);

    const toggleVnetSort = (field: string) => {
        setVnetSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' });
    };

    // ─── KPIs ─────────────────────────────────────────────────────────
    const totalSubnets = filteredVnets.reduce((s, v) => s + v.subnetCount, 0);
    const ddosProtected = filteredVnets.filter(v => v.ddosProtection).length;
    const defaultDenyPct = filteredNsgs.length > 0 ? Math.round((filteredNsgs.filter(n => n.defaultDeny).length / filteredNsgs.length) * 100) : 0;
    const nsgWithRisk = filteredNsgs.filter(n => n.highRiskPorts.length > 0).length;
    const fwCost = filteredFws.reduce((s, f) => s + f.monthlyCostUSD, 0);

    // ─── NSG rules chart ──────────────────────────────────────────────
    const nsgRulesData = React.useMemo(() =>
        filteredNsgs.map(n => ({
            name: n.name.replace('nsg-', ''),
            Allow: n.allowRules,
            Deny: n.denyRules,
        })),
        [filteredNsgs]
    );

    const kpis = [
        { label: 'Virtual Networks', value: filteredVnets.length.toString(), icon: Globe, color: '#3b82f6', desc: 'Total VNets' },
        { label: 'Subnets', value: totalSubnets.toString(), icon: Wifi, color: '#8b5cf6', desc: 'Total subnets across all VNets' },
        { label: 'NSGs', value: filteredNsgs.length.toString(), icon: Shield, color: '#06b6d4', desc: 'Network Security Groups' },
        { label: 'Firewalls', value: filteredFws.length.toString(), icon: ShieldCheck, color: '#22c55e', desc: 'Azure Firewalls' },
        { label: 'Load Balancers', value: filteredLbs.length.toString(), icon: Router, color: '#f97316', desc: 'Azure Load Balancers' },
        { label: 'DDoS Protected', value: `${ddosProtected}/${filteredVnets.length}`, icon: Lock, color: '#ec4899', desc: 'VNets with DDoS protection' },
    ];

    return (
        <TooltipProvider delayDuration={200}>
            <PageHeader>
                <PageHeaderHeading>Networks</PageHeaderHeading>
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

            {/* ── KPI Cards ── */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-6 dashboard-grid-stagger">
                {kpis.map(({ label, value, icon: Icon, color, desc }) => (
                    <Tooltip key={label}>
                        <TooltipTrigger asChild>
                            <div className="glass-card flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 hover:scale-[1.02] transition-all duration-200" style={{ outline: `1px solid ${color}25` }}>
                                <div className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}><Icon className="size-4" style={{ color }} /></div>
                                <div><p className="text-[10px] text-muted-foreground font-medium">{label}</p><p className="text-base font-bold tabular-nums leading-none stat-glow" style={{ color }}>{value}</p></div>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs max-w-[180px]"><p>{desc}</p></TooltipContent>
                    </Tooltip>
                ))}
            </div>

            {/* ── Security Posture ── */}
            <div className="grid gap-5 lg:grid-cols-3 mb-6">
                <Card className="glass-card gradient-border scan-line">
                    <CardHeader><CardTitle className="text-sm">Security Posture</CardTitle><CardDescription>NSG configuration status</CardDescription></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Default-Deny NSGs</span><span className="font-bold" style={{ color: defaultDenyPct === 100 ? '#22c55e' : '#f59e0b' }}>{defaultDenyPct}%</span></div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${defaultDenyPct}%`, background: defaultDenyPct === 100 ? '#22c55e' : '#f59e0b' }} /></div>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs"><span className="text-muted-foreground">DDoS Protection Coverage</span><span className="font-bold" style={{ color: ddosProtected === filteredVnets.length ? '#22c55e' : '#f59e0b' }}>{filteredVnets.length > 0 ? Math.round((ddosProtected / filteredVnets.length) * 100) : 0}%</span></div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${filteredVnets.length > 0 ? (ddosProtected / filteredVnets.length) * 100 : 0}%`, background: ddosProtected === filteredVnets.length ? '#22c55e' : '#f59e0b' }} /></div>
                        </div>
                        {nsgWithRisk > 0 && (
                            <div className="flex items-center gap-2 mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                                <ShieldAlert className="size-4 text-red-500 shrink-0" />
                                <p className="text-xs text-red-600 dark:text-red-400"><span className="font-bold">{nsgWithRisk} NSG{nsgWithRisk > 1 ? 's' : ''}</span> with high-risk open ports (22, 3389, 445)</p>
                            </div>
                        )}
                        <div className="pt-2 border-t border-border/30">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Firewall Cost/mo</span>
                                <span className="font-bold tabular-nums text-foreground">${fwCost.toLocaleString()}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* NSG Rules Chart */}
                <Card className="glass-card gradient-border scan-line">
                    <CardHeader><CardTitle className="text-sm">NSG Rules Distribution</CardTitle><CardDescription>Allow vs Deny rules per NSG</CardDescription></CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={nsgRulesData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="Allow" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="Deny" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Traffic Flow */}
                <Card className="glass-card gradient-border scan-line">
                    <CardHeader><CardTitle className="text-sm">Traffic Flow</CardTitle><CardDescription>Weekly inbound/outbound (GB)</CardDescription></CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={trafficData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                <Area type="monotone" dataKey="inbound" stroke="#3b82f6" fill="#3b82f620" strokeWidth={2} name="Inbound (GB)" />
                                <Area type="monotone" dataKey="outbound" stroke="#f97316" fill="#f9731620" strokeWidth={2} name="Outbound (GB)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* ── VNet Table ── */}
            <Card className="glass-card gradient-border mb-6">
                <CardHeader><CardTitle className="text-sm">Virtual Networks</CardTitle><CardDescription>{sortedVnets.length} VNet{sortedVnets.length !== 1 ? 's' : ''}</CardDescription></CardHeader>
                <CardContent className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="cursor-pointer select-none" onClick={() => toggleVnetSort('name')}><div className="flex items-center gap-1">Name <ArrowUpDown className="size-3" /></div></TableHead>
                                <TableHead>Subscription</TableHead>
                                <TableHead>Region</TableHead>
                                <TableHead>Address Space</TableHead>
                                <TableHead className="cursor-pointer select-none" onClick={() => toggleVnetSort('subnetCount')}><div className="flex items-center gap-1">Subnets <ArrowUpDown className="size-3" /></div></TableHead>
                                <TableHead>Peering</TableHead>
                                <TableHead className="text-center">DDoS</TableHead>
                                <TableHead>DNS</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedVnets.map(v => (
                                <TableRow key={v.id}>
                                    <TableCell className="font-medium font-mono text-xs">{v.name}</TableCell>
                                    <TableCell className="text-xs">{v.subscriptionName}</TableCell>
                                    <TableCell className="text-xs">{v.region}</TableCell>
                                    <TableCell className="font-mono text-xs">{v.addressSpace}</TableCell>
                                    <TableCell className="text-xs tabular-nums">{v.subnetCount}</TableCell>
                                    <TableCell className="text-xs">{v.peeredWith.length > 0 ? (
                                        <div className="flex flex-wrap gap-1">{v.peeredWith.map(p => <Badge key={p} variant="outline" className="text-[9px]">{p}</Badge>)}</div>
                                    ) : <span className="text-muted-foreground">None</span>}</TableCell>
                                    <TableCell className="text-center">{v.ddosProtection ? <ShieldCheck className="size-3.5 text-emerald-500 mx-auto" /> : <ShieldAlert className="size-3.5 text-amber-500 mx-auto" />}</TableCell>
                                    <TableCell className="text-xs">{v.dnsServers}</TableCell>
                                </TableRow>
                            ))}
                            {sortedVnets.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No VNets match the current filters</TableCell></TableRow>}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* ── Firewalls + Load Balancers ── */}
            <div className="grid gap-5 lg:grid-cols-2">
                <Card className="glass-card gradient-border">
                    <CardHeader><CardTitle className="text-sm">Azure Firewalls</CardTitle><CardDescription>{filteredFws.length} firewall{filteredFws.length !== 1 ? 's' : ''}</CardDescription></CardHeader>
                    <CardContent className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead><TableHead>Tier</TableHead><TableHead>Status</TableHead><TableHead>Rules</TableHead><TableHead>Threat Intel</TableHead><TableHead className="text-right">Cost/mo</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredFws.map(f => (
                                    <TableRow key={f.id}>
                                        <TableCell className="font-medium font-mono text-xs">{f.name}</TableCell>
                                        <TableCell><Badge variant="outline" className="text-[10px]">{f.tier}</Badge></TableCell>
                                        <TableCell><Badge variant="outline" className="text-[10px]" style={{ borderColor: f.status === 'Running' ? '#22c55e' : '#94a3b8', color: f.status === 'Running' ? '#22c55e' : '#94a3b8' }}>{f.status}</Badge></TableCell>
                                        <TableCell className="text-xs tabular-nums">{f.ruleCollections}</TableCell>
                                        <TableCell className="text-xs">{f.threatIntelMode}</TableCell>
                                        <TableCell className="text-right tabular-nums text-xs">${f.monthlyCostUSD.toLocaleString()}</TableCell>
                                    </TableRow>
                                ))}
                                {filteredFws.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No firewalls</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Card className="glass-card gradient-border">
                    <CardHeader><CardTitle className="text-sm">Load Balancers</CardTitle><CardDescription>{filteredLbs.length} load balancer{filteredLbs.length !== 1 ? 's' : ''}</CardDescription></CardHeader>
                    <CardContent className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>SKU</TableHead><TableHead>Region</TableHead><TableHead>Backend Pools</TableHead><TableHead>Rules</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLbs.map(l => (
                                    <TableRow key={l.id}>
                                        <TableCell className="font-medium font-mono text-xs">{l.name}</TableCell>
                                        <TableCell><Badge variant="outline" className="text-[10px]" style={{ borderColor: l.type === 'Public' ? '#3b82f6' : '#8b5cf6', color: l.type === 'Public' ? '#3b82f6' : '#8b5cf6' }}>{l.type}</Badge></TableCell>
                                        <TableCell className="text-xs">{l.sku}</TableCell>
                                        <TableCell className="text-xs">{l.region}</TableCell>
                                        <TableCell className="text-xs tabular-nums">{l.backendPools}</TableCell>
                                        <TableCell className="text-xs tabular-nums">{l.rules}</TableCell>
                                    </TableRow>
                                ))}
                                {filteredLbs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No load balancers</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </TooltipProvider>
    );
}
