import { cn } from '@/lib/utils';
import type { TrendsFilterState } from '@/types/assessment';
import type { TenantSubscription } from '@/types/assessment';

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
                value={filters.resourceGroupId}
                options={[
                    { value: '', label: 'All' },
                    ...resourceGroups.map((rg) => ({ value: rg, label: rg })),
                ]}
                onChange={(v) => onUpdate({ resourceGroupId: v })}
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
                value={filters.compareSubscriptionId}
                options={[
                    { value: '', label: 'None' },
                    ...subscriptions
                        .filter((s) => s.id !== filters.subscriptionId)
                        .map((s) => ({ value: s.id, label: s.name })),
                ]}
                onChange={(v) => onUpdate({ compareSubscriptionId: v })}
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
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                {label}
            </label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={cn(
                    'h-8 rounded-md border border-input bg-background px-2 py-1 text-sm',
                    'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    'text-foreground'
                )}
                aria-label={label}
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </div>
    );
}
