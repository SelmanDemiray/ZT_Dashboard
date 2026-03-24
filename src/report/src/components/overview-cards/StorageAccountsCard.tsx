import { useState, useMemo } from 'react';
import { displaySubName } from '@/lib/format-sub-name';
import { Database, ShieldCheck, ShieldAlert, Globe, Lock } from 'lucide-react';
import type { TenantSubscription, RunSnapshot } from '@/types/assessment';
import { FilterDropdown } from '@/components/ui/FilterDropdown';

interface Props {
    subscriptions: TenantSubscription[];
    subDataMap: Record<string, { latestSnapshot: RunSnapshot | null }>;
    defaultSubId: string;
}

export function StorageAccountsCard({ subscriptions, subDataMap, defaultSubId }: Props) {
    // Default to defaultSubId or 'all' to show tenant-wide view by default
    const [subId, setSubId] = useState<string>(defaultSubId && defaultSubId !== '' ? defaultSubId : 'all');
    const [tlsFilter, setTlsFilter] = useState<string>('');

    const accounts = useMemo(() => {
        if (subId === 'all') {
            return subscriptions.flatMap(sub => subDataMap[sub.id]?.latestSnapshot?.storageAccounts?.accounts || []);
        }
        return subDataMap[subId]?.latestSnapshot?.storageAccounts?.accounts || [];
    }, [subId, subscriptions, subDataMap]);

    const filteredAccounts = useMemo(() => {
        if (!tlsFilter) return accounts;
        if (tlsFilter === 'TLS1_2') return accounts.filter(a => (parseFloat(a.tlsVersion) || 0) >= 1.2 || a.tlsVersion === 'TLS1_2');
        if (tlsFilter === 'Public') return accounts.filter(a => a.publicNetworkAccess === 'Enabled');
        if (tlsFilter === 'HTTPS') return accounts.filter(a => a.supportsHttpsTrafficOnly);
        return accounts;
    }, [accounts, tlsFilter]);

    const stats = useMemo(() => {
        const s = { 
            total: accounts.length, 
            secureTls: 0, 
            insecureTls: 0, 
            publicAccess: 0,
            httpsOnly: 0 
        };
        for (const a of accounts) {
            const tls = parseFloat(a.tlsVersion) || 0;
            if (tls >= 1.2 || a.tlsVersion === 'TLS1_2') s.secureTls++;
            else s.insecureTls++;

            if (a.publicNetworkAccess === 'Enabled') s.publicAccess++;
            if (a.supportsHttpsTrafficOnly) s.httpsOnly++;
        }
        return s;
    }, [accounts]);

    const securePercent = stats.total > 0 ? Math.round((stats.secureTls / stats.total) * 100) : 0;

    // Circle thickness colour visualization
    const ringRadius = 36;
    const ringStroke = 8; // thicker circle
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference - (securePercent / 100) * ringCircumference;
    const ringColor = securePercent >= 90 ? '#22c55e' : securePercent >= 50 ? '#eab308' : '#ef4444';

    if (subscriptions.length === 0) {
        return (
            <div className="glass-card gradient-border p-6 flex items-center justify-center text-muted-foreground h-[380px]">
                <Database size={20} className="mr-2 opacity-50" />
                No subscriptions selected
            </div>
        );
    }

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden flex flex-col h-[380px]">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Database size={18} className="text-indigo-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Storage Accounts</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <FilterDropdown
                            value={subId}
                            onValueChange={v => setSubId(v)}
                            options={[
                                { value: 'all', label: 'All Subscriptions' },
                                ...subscriptions.map(s => ({ value: s.id, label: displaySubName(s) }))
                            ]}
                            className="w-[160px]"
                        />
                    </div>
                </div>
            </div>

            <div className="p-4 sm:p-5 flex-1 flex flex-col gap-4 overflow-hidden">
                <div className="flex items-center gap-6 justify-center pb-2 border-b border-border/30">
                    <div className="flex flex-col items-center gap-2">
                        <svg width={90} height={90} viewBox="0 0 90 90" className="drop-shadow-sm">
                            <circle cx="45" cy="45" r={ringRadius} fill="none" stroke="currentColor"
                                strokeWidth={ringStroke} className="text-muted/20" />
                            <circle cx="45" cy="45" r={ringRadius} fill="none" stroke={ringColor}
                                strokeWidth={ringStroke} strokeLinecap="round"
                                strokeDasharray={ringCircumference} strokeDashoffset={ringOffset}
                                className="progress-ring-animated duration-1000 ease-out"
                                style={{ transform: 'rotate(-90deg)', transformOrigin: '45px 45px', filter: `drop-shadow(0 0 6px ${ringColor}60)` }}
                            />
                            <text x="45" y="49" textAnchor="middle" className="fill-foreground font-bold" style={{ fontSize: '1.2rem' }}>
                                {securePercent}%
                            </text>
                        </svg>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Secure TLS</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pl-4 border-l border-border/50">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-full bg-indigo-500/10 text-indigo-400">
                                <Database size={14} />
                            </div>
                            <div>
                                <p className="text-sm font-bold">{stats.total}</p>
                                <p className="text-[10px] text-muted-foreground">Total</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 cursor-pointer hover:bg-emerald-500/5 rounded p-1 transition-colors" onClick={() => setTlsFilter(tlsFilter === 'TLS1_2' ? '' : 'TLS1_2')}>
                            <div className={`p-1.5 rounded-full ${tlsFilter === 'TLS1_2' ? 'bg-emerald-500/30' : 'bg-emerald-500/10'} text-emerald-400`}>
                                <ShieldCheck size={14} />
                            </div>
                            <div>
                                <p className="text-sm font-bold">{stats.secureTls}</p>
                                <p className="text-[10px] text-muted-foreground">TLS 1.2+</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 cursor-pointer hover:bg-amber-500/5 rounded p-1 transition-colors" onClick={() => setTlsFilter(tlsFilter === 'Public' ? '' : 'Public')}>
                            <div className={`p-1.5 rounded-full ${tlsFilter === 'Public' ? 'bg-amber-500/30' : 'bg-amber-500/10'} text-amber-500`}>
                                <Globe size={14} />
                            </div>
                            <div>
                                <p className="text-sm font-bold">{stats.publicAccess}</p>
                                <p className="text-[10px] text-muted-foreground">Public Net</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 cursor-pointer hover:bg-blue-500/5 rounded p-1 transition-colors" onClick={() => setTlsFilter(tlsFilter === 'HTTPS' ? '' : 'HTTPS')}>
                            <div className={`p-1.5 rounded-full ${tlsFilter === 'HTTPS' ? 'bg-blue-500/30' : 'bg-blue-500/10'} text-blue-400`}>
                                <Lock size={14} />
                            </div>
                            <div>
                                <p className="text-sm font-bold">{stats.httpsOnly}</p>
                                <p className="text-[10px] text-muted-foreground">HTTPS Only</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-1 space-y-2 mt-2">
                    {filteredAccounts.length === 0 && (
                        <p className="text-center text-xs text-muted-foreground py-4">No storage accounts found.</p>
                    )}
                    {filteredAccounts.map(account => {
                        const isSecureTls = (parseFloat(account.tlsVersion) || 0) >= 1.2 || account.tlsVersion === 'TLS1_2';
                        return (
                            <div key={account.id} className="rounded-lg border border-border/50 bg-card/40 p-3 hover:bg-card/80 transition-all flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <h4 className="text-xs font-semibold truncate text-foreground/90" title={account.name}>
                                        {account.name}
                                    </h4>
                                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                        {account.resourceGroup}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <div className={`px-2 py-0.5 rounded text-[9px] font-medium tracking-wide flex items-center gap-1 border ${
                                        isSecureTls 
                                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                                    }`}>
                                        {isSecureTls ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
                                        {account.tlsVersion || 'Unknown'}
                                    </div>
                                    <div className={`px-2 py-0.5 rounded text-[9px] font-medium tracking-wide flex items-center gap-1 border ${
                                        account.publicNetworkAccess === 'Enabled'
                                            ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                            : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                    }`}>
                                        <Globe size={10} />
                                        {account.publicNetworkAccess === 'Enabled' ? 'Public' : 'Private'}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
