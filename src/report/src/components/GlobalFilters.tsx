import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { cn } from '@/lib/utils';

export function GlobalFilters() {
    const {
        filters,
        dispatch,
        availableTenants,
        availableSubscriptions,
        availableResourceGroups,
        loading,
    } = useGlobalFilters();

    if (loading) return null;
    if (availableTenants.length === 0) return null;

    return (
        <div
            className={cn(
                'sticky top-14 z-40 w-full border-b bg-background/95 backdrop-blur supports-backdrop-blur:bg-background/60'
            )}
            role="toolbar"
            aria-label="Global filters"
        >
            <div className="container max-w-6xl px-4 md:px-8 py-2 flex flex-wrap items-center gap-2">
                {/* Tenant */}
                <FilterSelect
                    label="Tenant"
                    value={filters.tenantId}
                    options={availableTenants.map((t) => ({ value: t.id, label: t.name }))}
                    onChange={(v) => dispatch({ type: 'SET_TENANT', tenantId: v })}
                />

                {/* Subscription */}
                <FilterSelect
                    label="Subscription"
                    value={filters.subscriptionId}
                    options={availableSubscriptions.map((s) => ({ value: s.id, label: s.name }))}
                    onChange={(v) => dispatch({ type: 'SET_SUBSCRIPTION', subscriptionId: v })}
                />

                {/* Resource Group */}
                {availableResourceGroups.length > 0 && (
                    <FilterSelect
                        label="Resource Group"
                        value={filters.resourceGroupId}
                        options={[
                            { value: '', label: 'All' },
                            ...availableResourceGroups.map((rg) => ({ value: rg, label: rg })),
                        ]}
                        onChange={(v) =>
                            dispatch({ type: 'SET_RESOURCE_GROUP', resourceGroupId: v })
                        }
                    />
                )}

                {/* Severity */}
                <FilterSelect
                    label="Severity"
                    value={filters.severity}
                    options={[
                        { value: '', label: 'All' },
                        { value: 'critical', label: 'Critical' },
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' },
                    ]}
                    onChange={(v) => dispatch({ type: 'SET_SEVERITY', severity: v })}
                />

                {/* Status */}
                <FilterSelect
                    label="Status"
                    value={filters.status}
                    options={[
                        { value: '', label: 'All' },
                        { value: 'passed', label: 'Passed' },
                        { value: 'failed', label: 'Failed' },
                        { value: 'investigate', label: 'Investigate' },
                    ]}
                    onChange={(v) => dispatch({ type: 'SET_STATUS', status: v })}
                />
            </div>
        </div>
    );
}

// ─── Reusable select built with native <select> styled to match ──────

interface FilterSelectProps {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
    return (
        <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">
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
