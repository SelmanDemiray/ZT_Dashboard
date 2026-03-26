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
    Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
    Globe, Shield, Wifi, Router, ArrowUpDown, ShieldCheck,
    ShieldAlert, Lock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { VNet, NSG, Firewall, LoadBalancer } from '@/types/assessment';
import { fetchNetworks } from '@/services/blobService';

export default function Networks() {
    const { filters, dispatch, availableSubscriptions, availableDates } = useGlobalFilters();
    const { settings } = useSettings();
    const [vnetSort, setVnetSort] = React.useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'subnetCount', dir: 'desc' });

    // ─── Fetch blob data ──────────────────────────────────────────────
    const [allVnets, setAllVnets] = React.useState<VNet[]>([]);
    const [allNsgs, setAllNsgs] = React.useState<NSG[]>([]);
    const [allFws, setAllFws] = React.useState<Firewall[]>([]);
    const [allLbs, setAllLbs] = React.useState<LoadBalancer[]>([]);

    React.useEffect(() => {
        if (!filters.tenantId || availableSubscriptions.length === 0) {
            setAllVnets([]); setAllNsgs([]); setAllFws([]); setAllLbs([]); return;
        }
        let cancelled = false;
        const tasks = availableSubscriptions.map(sub =>
            fetchNetworks(filters.tenantId, sub.id, 'latest').catch(() => null)
        );
        Promise.all(tasks).then(results => {
            if (cancelled) return;
            setAllVnets(results.flatMap(r => r?.vnets ?? []));
            setAllNsgs(results.flatMap(r => r?.nsgs ?? []));
            setAllFws(results.flatMap(r => r?.firewalls ?? []));
            setAllLbs(results.flatMap(r => r?.loadBalancers ?? []));
        });
        return () => { cancelled = true; };
    }, [filters.tenantId, availableSubscriptions, availableDates]);

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

    const filteredVnets = React.useMemo(() => applyTagFilter(applySubFilter(allVnets)), [allVnets, filters, settings]);
    const filteredNsgs = React.useMemo(() => applySubFilter(allNsgs), [allNsgs, filters]);
    const filteredFws = React.useMemo(() => applySubFilter(allFws), [allFws, filters]);
    const filteredLbs = React.useMemo(() => applySubFilter(allLbs), [allLbs, filters]);

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

                {/* Network Summary */}
                <Card className="glass-card gradient-border scan-line">
                    <CardHeader><CardTitle className="text-sm">Network Resources</CardTitle><CardDescription>Total resource counts</CardDescription></CardHeader>
                    <CardContent className="flex items-center gap-8 pt-4">
                        <div className="text-center">
                            <p className="text-3xl font-bold tabular-nums text-blue-500">{filteredVnets.length}</p>
                            <p className="text-xs text-muted-foreground">Virtual Networks</p>
                        </div>
                        <div className="text-center">
                            <p className="text-3xl font-bold tabular-nums text-amber-500">{filteredNsgs.length}</p>
                            <p className="text-xs text-muted-foreground">NSGs</p>
                        </div>
                        <div className="text-center">
                            <p className="text-3xl font-bold tabular-nums text-red-500">{filteredFws.length}</p>
                            <p className="text-xs text-muted-foreground">Firewalls</p>
                        </div>
                        <div className="text-center">
                            <p className="text-3xl font-bold tabular-nums text-green-500">{filteredLbs.length}</p>
                            <p className="text-xs text-muted-foreground">Load Balancers</p>
                        </div>
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
