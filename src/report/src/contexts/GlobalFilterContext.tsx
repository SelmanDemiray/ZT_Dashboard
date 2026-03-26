/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { GlobalFilterState, TenantIndex, TenantEntry, TenantSubscription } from '@/types/assessment';
import type { ZeroTrustAssessmentReport, Test } from '@/config/report-data';
import { reportData as staticReportData } from '@/config/report-data';
import { fetchTenantIndex, fetchPolicyMapping } from '@/services/blobService';
import { fetchReportData } from '@/services/reportDataService';
import { useSettings } from './SettingsContext';

// ─── Context shape ────────────────────────────────────────────────────

interface GlobalFilterContextValue {
    filters: GlobalFilterState;
    tenantIndex: TenantIndex | null;
    loading: boolean;
    /** Live report data from blob (falls back to an empty state if fetch fails). */
    reportData: ZeroTrustAssessmentReport;
    /** Tests filtered by active operational area, team, and keyword filters. */
    filteredTests: Test[];
    reportLoading: boolean;
    dispatch: React.Dispatch<FilterAction>;
    availableTenants: TenantEntry[];
    availableSubscriptions: TenantSubscription[];
    availableResourceGroups: string[];
    availableDates: string[];
    policyMapping: Record<string, string>;
}

const defaultFilters: GlobalFilterState = {
    tenantId: '',
    subscriptionId: '',
    resourceGroupId: '',
    resourceType: '',
    severity: '',
    status: '',
    dateRange: [
        new Date(new Date().setMonth(new Date().getMonth() - 6)),
        new Date(),
    ],
    granularity: 'monthly',
    operationalArea: '',
    team: '',
    keyword: '',
};

const GlobalFilterContext = createContext<GlobalFilterContextValue | null>(null);

// ─── Reducer ──────────────────────────────────────────────────────────

type FilterAction =
    | { type: 'SET_TENANT'; tenantId: string }
    | { type: 'SET_SUBSCRIPTION'; subscriptionId: string }
    | { type: 'SET_RESOURCE_GROUP'; resourceGroupId: string }
    | { type: 'SET_RESOURCE_TYPE'; resourceType: string }
    | { type: 'SET_SEVERITY'; severity: string }
    | { type: 'SET_STATUS'; status: string }
    | { type: 'SET_DATE_RANGE'; dateRange: [Date, Date] }
    | { type: 'SET_GRANULARITY'; granularity: 'weekly' | 'monthly' }
    | { type: 'SET_OPERATIONAL_AREA'; operationalArea: string }
    | { type: 'SET_TEAM'; team: string }
    | { type: 'SET_KEYWORD'; keyword: string };

function filterReducer(
    state: GlobalFilterState,
    action: FilterAction
): GlobalFilterState {
    switch (action.type) {
        case 'SET_TENANT':
            return {
                ...state,
                tenantId: action.tenantId,
                subscriptionId: '',
                resourceGroupId: '',
            };
        case 'SET_SUBSCRIPTION':
            return {
                ...state,
                subscriptionId: action.subscriptionId,
                resourceGroupId: '',
            };
        case 'SET_RESOURCE_GROUP':
            return { ...state, resourceGroupId: action.resourceGroupId };
        case 'SET_RESOURCE_TYPE':
            return { ...state, resourceType: action.resourceType };
        case 'SET_SEVERITY':
            return { ...state, severity: action.severity };
        case 'SET_STATUS':
            return { ...state, status: action.status };
        case 'SET_DATE_RANGE':
            return { ...state, dateRange: action.dateRange };
        case 'SET_GRANULARITY':
            return { ...state, granularity: action.granularity };
        case 'SET_OPERATIONAL_AREA':
            return { ...state, operationalArea: action.operationalArea };
        case 'SET_TEAM':
            return { ...state, team: action.team };
        case 'SET_KEYWORD':
            return { ...state, keyword: action.keyword };
        default:
            return state;
    }
}

// ─── Provider ─────────────────────────────────────────────────────────

export function GlobalFilterProvider({ children }: { children: ReactNode }) {
    const [filters, dispatch] = useReducer(filterReducer, defaultFilters);
    const [tenantIndex, setTenantIndex] = useReducerState<TenantIndex | null>(null);
    const [loading, setLoading] = useReducerState<boolean>(true);
    const [liveReportData, setLiveReportData] = useReducerState<ZeroTrustAssessmentReport>(staticReportData);
    const [reportLoading, setReportLoading] = useReducerState<boolean>(true);
    const [policyMapping, setPolicyMapping] = useReducerState<Record<string, string>>({});
    const { settings } = useSettings();

    useEffect(() => {
        let cancelled = false;

        // Fetch both tenant-index and report-data in parallel
        Promise.allSettled([
            fetchTenantIndex(),
            fetchReportData(),
        ]).then(([indexResult, reportResult]) => {
            if (cancelled) return;

            // Handle tenant index
            if (indexResult.status === 'fulfilled') {
                const data = indexResult.value;
                setTenantIndex(data);
                if (data.tenants.length > 0) {
                    dispatch({ type: 'SET_TENANT', tenantId: data.tenants[0].id });
                    // Do NOT auto-select subscription — default to tenant-wide view
                }
            } else {
                console.error('Failed to fetch tenant index:', indexResult.reason);
            }

            // Handle report data — fall back to empty static state on error
            if (reportResult.status === 'fulfilled') {
                setLiveReportData(reportResult.value);
            } else {
                console.warn('Failed to fetch live report-data.json, using fallback empty state:', reportResult.reason);
            }
        }).finally(() => {
            if (!cancelled) {
                setLoading(false);
                setReportLoading(false);
            }
        });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch policy mapping when tenant changes
    useEffect(() => {
        if (!filters.tenantId) return;
        let cancelled = false;
        fetchPolicyMapping(filters.tenantId).then(res => {
            if (!cancelled) setPolicyMapping(res.mapping);
        }).catch(err => {
            console.warn('Failed to fetch policy mapping:', err);
            if (!cancelled) setPolicyMapping({});
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.tenantId]);

    // ─── Cascading derived lists ──────────────────────────────────────

    const availableTenants = useMemo(() => tenantIndex?.tenants ?? [], [tenantIndex]);

    const availableSubscriptions = useMemo(() => {
        // Tenant-wide subscription scope should not be reduced by Area/Team/Keyword selectors.
        // Those selectors filter *tests* (see `filteredTests`), not the subscription list itself.
        return availableTenants.find((t) => t.id === filters.tenantId)?.subscriptions ?? [];
    }, [availableTenants, filters.tenantId]);

    const availableResourceGroups = useMemo(() => {
        // When "All subscriptions" is selected, show resource groups across the whole tenant scope.
        if (!filters.subscriptionId) {
            return Array.from(
                new Set(
                    availableSubscriptions.flatMap((s) => s.resourceGroups ?? [])
                )
            ).sort();
        }

        return availableSubscriptions.find((s) => s.id === filters.subscriptionId)?.resourceGroups ?? [];
    }, [availableSubscriptions, filters.subscriptionId]);

    const availableDates = useMemo(() => 
        filters.subscriptionId
            ? (availableSubscriptions.find((s) => s.id === filters.subscriptionId)?.dates ?? [])
            : [...new Set(availableSubscriptions.flatMap(s => s.dates))].sort(),
        [availableSubscriptions, filters.subscriptionId]
    );

    // ─── Filtered tests ───────────────────────────────────────────────

    const filteredTests = useMemo(() => {
        let tests = liveReportData.Tests ?? [];

        // Filter by operational area group
        if (filters.operationalArea) {
            const group = settings.operationalAreas.find(g => g.id === filters.operationalArea);
            if (group && group.values.length > 0) {
                const lowerVals = group.values.map(v => v.toLowerCase());
                tests = tests.filter(t => {
                    const pillar = (t.TestPillar ?? '').toLowerCase();
                    const category = (t.TestCategory ?? '').toLowerCase();
                    return lowerVals.some(v => pillar.includes(v) || category.includes(v));
                });
            }
        }

        // Filter by team group
        if (filters.team) {
            const group = settings.teams.find(g => g.id === filters.team);
            if (group && group.values.length > 0) {
                const lowerVals = group.values.map(v => v.toLowerCase());
                tests = tests.filter(t => {
                    const tags = (t.TestTags ?? []).map(tag => tag.toLowerCase());
                    const appliesTo = (t.TestAppliesTo ?? []).map(a => a.toLowerCase());
                    return lowerVals.some(v =>
                        tags.some(tag => tag.includes(v)) ||
                        appliesTo.some(a => a.includes(v))
                    );
                });
            }
        }

        // Filter by keyword group
        if (filters.keyword) {
            const group = settings.keywords.find(g => g.id === filters.keyword);
            if (group && group.values.length > 0) {
                const lowerVals = group.values.map(v => v.toLowerCase());
                tests = tests.filter(t => {
                    const title = (t.TestTitle ?? '').toLowerCase();
                    const desc = (t.TestDescription ?? '').toLowerCase();
                    return lowerVals.some(v => title.includes(v) || desc.includes(v));
                });
            }
        }

        return tests;
    }, [liveReportData.Tests, filters.operationalArea, filters.team, filters.keyword, settings]);

    const value: GlobalFilterContextValue = useMemo(() => ({
        filters,
        tenantIndex,
        loading,
        reportData: liveReportData,
        filteredTests,
        reportLoading,
        dispatch,
        availableTenants,
        availableSubscriptions,
        availableResourceGroups,
        availableDates,
        policyMapping,
    }), [
        filters,
        tenantIndex,
        loading,
        liveReportData,
        filteredTests,
        reportLoading,
        availableTenants,
        availableSubscriptions,
        availableResourceGroups,
        availableDates,
        policyMapping
    ]);

    return (
        <GlobalFilterContext.Provider value={value}>
            {children}
        </GlobalFilterContext.Provider>
    );
}

// ─── Hook ─────────────────────────────────────────────────────────────

export function useGlobalFilters(): GlobalFilterContextValue {
    const ctx = useContext(GlobalFilterContext);
    if (!ctx) {
        throw new Error('useGlobalFilters must be used within a GlobalFilterProvider');
    }
    return ctx;
}

// ─── Simple state helper (avoids importing useState separately) ──────

function useReducerState<T>(
    initial: T
): [T, (val: T) => void] {
    const [state, dispatch] = useReducer(
        (_: T, action: T) => action,
        initial
    );
    const setter = useCallback((val: T) => dispatch(val), []);
    return [state, setter];
}

export { GlobalFilterContext };
