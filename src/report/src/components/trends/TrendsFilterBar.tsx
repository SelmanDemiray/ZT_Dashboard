import type { TrendsFilterState } from '@/types/assessment';
import type { TenantSubscription } from '@/types/assessment';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TrendsFilterBarProps {
    filters: TrendsFilterState;
    subscriptions: TenantSubscription[];
    resourceGroups: string[];
    onUpdate: (partial: Partial<TrendsFilterState>) => void;
}

export function TrendsFilterBar({
    filters,
    subscriptions,
    resourceGroups,
    onUpdate,
}: TrendsFilterBarProps) {
    return (
        <div
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3 mb-6"
            role="toolbar"
            aria-label="Trends filters"
        >
            {/* Subscription */}
            <TrendsSelect
                label="Subscription"
                value={filters.subscriptionId}
                options={subscriptions.map((s) => ({ value: s.id, label: s.name }))}
                onChange={(v) => onUpdate({ subscriptionId: v, resourceGroupId: '' })}
            />

            {/* Resource Group */}
            <TrendsSelect
                label="Resource Group"
                value={filters.resourceGroupId || 'all'}
                options={[
                    { value: 'all', label: 'All' },
                    ...resourceGroups.map((rg) => ({ value: rg, label: rg })),
                ]}
                onChange={(v) => onUpdate({ resourceGroupId: v === 'all' ? '' : v })}
            />

            {/* Data Source */}
            <TrendsSelect
                label="Data Source"
                value={filters.dataSource}
                options={[
                    { value: 'all', label: 'All' },
                    { value: 'zeroTrust', label: 'Zero Trust' },
                    { value: 'policy', label: 'Policy' },
                    { value: 'defender', label: 'Defender' },
                    { value: 'governance', label: 'Governance' },
                ]}
                onChange={(v) =>
                    onUpdate({
                        dataSource: v as TrendsFilterState['dataSource'],
                    })
                }
            />

            {/* Date Range */}
            <TrendsSelect
                label="Date Range"
                value="6m"
                options={[
                    { value: '3m', label: 'Last 3 Months' },
                    { value: '6m', label: 'Last 6 Months' },
                    { value: '12m', label: 'Last 12 Months' },
                ]}
                onChange={(v) => {
                    const months = v === '3m' ? 3 : v === '12m' ? 12 : 6;
                    const end = new Date();
                    const start = new Date();
                    start.setMonth(start.getMonth() - months);
                    onUpdate({ dateRange: [start, end] });
                }}
            />

            {/* Granularity */}
            <TrendsSelect
                label="Granularity"
                value={filters.granularity}
                options={[
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'weekly', label: 'Weekly' },
                ]}
                onChange={(v) =>
                    onUpdate({ granularity: v as 'weekly' | 'monthly' })
                }
            />

            {/* Compare */}
            <TrendsSelect
                label="Compare"
                value={filters.compareSubscriptionId || 'none'}
                options={[
                    { value: 'none', label: 'None' },
                    ...subscriptions
                        .filter((s) => s.id !== filters.subscriptionId)
                        .map((s) => ({ value: s.id, label: s.name })),
                ]}
                onChange={(v) => onUpdate({ compareSubscriptionId: v === 'none' ? '' : v })}
            />
        </div>
    );
}

interface TrendsSelectProps {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}

function TrendsSelect({ label, value, options, onChange }: TrendsSelectProps) {
    return (
        <div className="flex items-center gap-1.5">
            <label className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground whitespace-nowrap">
                {label}
            </label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="h-8 max-w-[200px] text-xs glass-card border-none hover:bg-muted/50 transition-colors">
                    <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent className="glass-card">
                    {options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label || 'None'}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
