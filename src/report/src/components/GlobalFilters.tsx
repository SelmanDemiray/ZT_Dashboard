import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { useSettings } from '@/contexts/SettingsContext';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function GlobalFilters() {
    const {
        filters,
        dispatch,
        availableTenants,
        availableSubscriptions,
        availableResourceGroups,
        loading,
    } = useGlobalFilters();
    const { settings } = useSettings();

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
                    value={filters.subscriptionId || 'all'}
                    options={[
                        { value: 'all', label: 'All Subscriptions' },
                        ...availableSubscriptions.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                    onChange={(v) => dispatch({ type: 'SET_SUBSCRIPTION', subscriptionId: v === 'all' ? '' : v })}
                />

                {/* Resource Group */}
                {availableResourceGroups.length > 0 && (
                    <FilterSelect
                        label="Resource Group"
                        value={filters.resourceGroupId || 'all'}
                        options={[
                            { value: 'all', label: 'All' },
                            ...availableResourceGroups.map((rg) => ({ value: rg, label: rg })),
                        ]}
                        onChange={(v) =>
                            dispatch({ type: 'SET_RESOURCE_GROUP', resourceGroupId: v === 'all' ? '' : v })
                        }
                    />
                )}

                {/* Severity */}
                <FilterSelect
                    label="Severity"
                    value={filters.severity || 'all'}
                    options={[
                        { value: 'all', label: 'All' },
                        { value: 'critical', label: 'Critical' },
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' },
                    ]}
                    onChange={(v) => dispatch({ type: 'SET_SEVERITY', severity: v === 'all' ? '' : v })}
                />

                {/* Status */}
                <FilterSelect
                    label="Status"
                    value={filters.status || 'all'}
                    options={[
                        { value: 'all', label: 'All' },
                        { value: 'passed', label: 'Passed' },
                        { value: 'failed', label: 'Failed' },
                        { value: 'investigate', label: 'Investigate' },
                    ]}
                    onChange={(v) => dispatch({ type: 'SET_STATUS', status: v === 'all' ? '' : v })}
                />

                {/* ── Settings-based filters ── */}
                <div className="h-4 w-px bg-border/60 mx-1 hidden sm:block" />

                {/* Operational Area */}
                {settings.operationalAreas.length > 0 && (
                    <FilterSelect
                        label="Area"
                        value={filters.operationalArea || 'all'}
                        options={[
                            { value: 'all', label: 'All Areas' },
                            ...settings.operationalAreas.map((g) => ({ value: g.id, label: g.name })),
                        ]}
                        onChange={(v) => dispatch({ type: 'SET_OPERATIONAL_AREA', operationalArea: v === 'all' ? '' : v })}
                    />
                )}

                {/* Team */}
                {settings.teams.length > 0 && (
                    <FilterSelect
                        label="Team"
                        value={filters.team || 'all'}
                        options={[
                            { value: 'all', label: 'All Teams' },
                            ...settings.teams.map((g) => ({ value: g.id, label: g.name })),
                        ]}
                        onChange={(v) => dispatch({ type: 'SET_TEAM', team: v === 'all' ? '' : v })}
                    />
                )}

                {/* Keyword */}
                {settings.keywords.length > 0 && (
                    <FilterSelect
                        label="Keyword"
                        value={filters.keyword || 'all'}
                        options={[
                            { value: 'all', label: 'All Keywords' },
                            ...settings.keywords.map((g) => ({ value: g.id, label: g.name })),
                        ]}
                        onChange={(v) => dispatch({ type: 'SET_KEYWORD', keyword: v === 'all' ? '' : v })}
                    />
                )}
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
