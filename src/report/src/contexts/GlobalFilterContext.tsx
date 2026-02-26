import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import type { GlobalFilterState, TenantIndex, TenantEntry, TenantSubscription } from '@/types/assessment';
import { fetchTenantIndex } from '@/services/blobService';

// ─── Context shape ────────────────────────────────────────────────────

interface GlobalFilterContextValue {
    filters: GlobalFilterState;
    tenantIndex: TenantIndex | null;
    loading: boolean;
    dispatch: React.Dispatch<FilterAction>;
    availableTenants: TenantEntry[];
    availableSubscriptions: TenantSubscription[];
    availableResourceGroups: string[];
    availableDates: string[];
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
    | { type: 'SET_GRANULARITY'; granularity: 'weekly' | 'monthly' };

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
        default:
            return state;
    }
}

// ─── Provider ─────────────────────────────────────────────────────────

export function GlobalFilterProvider({ children }: { children: ReactNode }) {
    const [filters, dispatch] = useReducer(filterReducer, defaultFilters);
    const [tenantIndex, setTenantIndex] = useReducerState<TenantIndex | null>(null);
    const [loading, setLoading] = useReducerState<boolean>(true);

    useEffect(() => {
        let cancelled = false;
        fetchTenantIndex()
            .then((data) => {
                if (cancelled) return;
                setTenantIndex(data);
                // Auto-select first tenant and subscription
                if (data.tenants.length > 0) {
                    dispatch({ type: 'SET_TENANT', tenantId: data.tenants[0].id });
                    if (data.tenants[0].subscriptions.length > 0) {
                        dispatch({
                            type: 'SET_SUBSCRIPTION',
                            subscriptionId: data.tenants[0].subscriptions[0].id,
                        });
                    }
                }
            })
            .catch((err) => {
                console.error('Failed to fetch tenant index:', err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    // ─── Cascading derived lists ──────────────────────────────────────

    const availableTenants = tenantIndex?.tenants ?? [];

    const availableSubscriptions =
        availableTenants.find((t) => t.id === filters.tenantId)?.subscriptions ?? [];

    const availableResourceGroups =
        availableSubscriptions.find((s) => s.id === filters.subscriptionId)
            ?.resourceGroups ?? [];

    const availableDates =
        availableSubscriptions.find((s) => s.id === filters.subscriptionId)
            ?.dates ?? [];

    const value: GlobalFilterContextValue = {
        filters,
        tenantIndex,
        loading,
        dispatch,
        availableTenants,
        availableSubscriptions,
        availableResourceGroups,
        availableDates,
    };

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
