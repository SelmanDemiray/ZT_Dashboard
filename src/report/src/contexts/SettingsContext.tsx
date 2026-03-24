/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, type ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────────

export interface FilterGroup {
    id: string;
    name: string;
    values: string[];
    subscriptions?: string[];
    resourceGroups?: string[];
}

export interface SettingsState {
    operationalAreas: FilterGroup[];
    teams: FilterGroup[];
    keywords: FilterGroup[];
}

type GroupCategory = 'operationalAreas' | 'teams' | 'keywords';

// ─── Actions ──────────────────────────────────────────────────────────

type SettingsAction =
    | { type: 'ADD_GROUP'; category: GroupCategory; group: FilterGroup }
    | { type: 'UPDATE_GROUP'; category: GroupCategory; id: string; name: string }
    | { type: 'DELETE_GROUP'; category: GroupCategory; id: string }
    | { type: 'ADD_ITEM'; category: GroupCategory; groupId: string; value: string }
    | { type: 'REMOVE_ITEM'; category: GroupCategory; groupId: string; value: string }
    | { type: 'ADD_LINK_ITEM'; category: GroupCategory; groupId: string; linkType: 'subscriptions' | 'resourceGroups'; value: string }
    | { type: 'REMOVE_LINK_ITEM'; category: GroupCategory; groupId: string; linkType: 'subscriptions' | 'resourceGroups'; value: string }
    | { type: 'LOAD'; state: SettingsState };

// ─── Defaults ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'zt-dashboard-settings';

function genId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const defaultSettings: SettingsState = {
    operationalAreas: [
        { id: genId(), name: 'Identity', values: ['Identity'] },
        { id: genId(), name: 'Devices', values: ['Devices'] },
        { id: genId(), name: 'Data', values: ['Data'] },
        { id: genId(), name: 'Network', values: ['Network'] },
    ],
    teams: [],
    keywords: [],
};

// ─── Reducer ──────────────────────────────────────────────────────────

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
    switch (action.type) {
        case 'LOAD':
            return action.state;

        case 'ADD_GROUP':
            return {
                ...state,
                [action.category]: [...state[action.category], action.group],
            };

        case 'UPDATE_GROUP':
            return {
                ...state,
                [action.category]: state[action.category].map((g) =>
                    g.id === action.id ? { ...g, name: action.name } : g
                ),
            };

        case 'DELETE_GROUP':
            return {
                ...state,
                [action.category]: state[action.category].filter((g) => g.id !== action.id),
            };

        case 'ADD_ITEM':
            return {
                ...state,
                [action.category]: state[action.category].map((g) =>
                    g.id === action.groupId && !g.values.includes(action.value)
                        ? { ...g, values: [...g.values, action.value] }
                        : g
                ),
            };

        case 'REMOVE_ITEM':
            return {
                ...state,
                [action.category]: state[action.category].map((g) =>
                    g.id === action.groupId
                        ? { ...g, values: g.values.filter((v) => v !== action.value) }
                        : g
                ),
            };

        case 'ADD_LINK_ITEM':
            return {
                ...state,
                [action.category]: state[action.category].map((g) => {
                    if (g.id !== action.groupId) return g;
                    const list = g[action.linkType] || [];
                    if (list.includes(action.value)) return g;
                    return { ...g, [action.linkType]: [...list, action.value] };
                }),
            };

        case 'REMOVE_LINK_ITEM':
            return {
                ...state,
                [action.category]: state[action.category].map((g) => {
                    if (g.id !== action.groupId) return g;
                    const list = g[action.linkType] || [];
                    return { ...g, [action.linkType]: list.filter((v) => v !== action.value) };
                }),
            };

        default:
            return state;
    }
}

// ─── Context ──────────────────────────────────────────────────────────

interface SettingsContextValue {
    settings: SettingsState;
    dispatch: React.Dispatch<SettingsAction>;
    /** Helper to add a new group with a generated ID */
    addGroup: (category: GroupCategory, name: string, values?: string[]) => void;
    /** Helper to delete a group */
    deleteGroup: (category: GroupCategory, id: string) => void;
    /** Helper to rename a group */
    renameGroup: (category: GroupCategory, id: string, name: string) => void;
    /** Helper to add an item to a group */
    addItem: (category: GroupCategory, groupId: string, value: string) => void;
    /** Helper to remove an item from a group */
    removeItem: (category: GroupCategory, groupId: string, value: string) => void;
    /** Helper to add a link item */
    addLinkItem: (category: GroupCategory, groupId: string, linkType: 'subscriptions' | 'resourceGroups', value: string) => void;
    /** Helper to remove a link item */
    removeLinkItem: (category: GroupCategory, groupId: string, linkType: 'subscriptions' | 'resourceGroups', value: string) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, dispatch] = useReducer(settingsReducer, defaultSettings);

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as SettingsState;
                // Validate shape before loading
                if (parsed.operationalAreas && parsed.teams && parsed.keywords) {
                    dispatch({ type: 'LOAD', state: parsed });
                }
            }
        } catch {
            console.warn('Failed to load settings from localStorage');
        }
    }, []);

    // Persist to localStorage on every change
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch {
            console.warn('Failed to persist settings to localStorage');
        }
    }, [settings]);

    const addGroup = useCallback((category: GroupCategory, name: string, values: string[] = []) => {
        dispatch({ type: 'ADD_GROUP', category, group: { id: genId(), name, values } });
    }, []);

    const deleteGroup = useCallback((category: GroupCategory, id: string) => {
        dispatch({ type: 'DELETE_GROUP', category, id });
    }, []);

    const renameGroup = useCallback((category: GroupCategory, id: string, name: string) => {
        dispatch({ type: 'UPDATE_GROUP', category, id, name });
    }, []);

    const addItem = useCallback((category: GroupCategory, groupId: string, value: string) => {
        dispatch({ type: 'ADD_ITEM', category, groupId, value });
    }, []);

    const removeItem = useCallback((category: GroupCategory, groupId: string, value: string) => {
        dispatch({ type: 'REMOVE_ITEM', category, groupId, value });
    }, []);

    const addLinkItem = useCallback((category: GroupCategory, groupId: string, linkType: 'subscriptions' | 'resourceGroups', value: string) => {
        dispatch({ type: 'ADD_LINK_ITEM', category, groupId, linkType, value });
    }, []);

    const removeLinkItem = useCallback((category: GroupCategory, groupId: string, linkType: 'subscriptions' | 'resourceGroups', value: string) => {
        dispatch({ type: 'REMOVE_LINK_ITEM', category, groupId, linkType, value });
    }, []);

    const value = useMemo<SettingsContextValue>(() => ({
        settings, dispatch, addGroup, deleteGroup, renameGroup, addItem, removeItem, addLinkItem, removeLinkItem
    }), [settings, addGroup, deleteGroup, renameGroup, addItem, removeItem, addLinkItem, removeLinkItem]);

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    );
}

// ─── Hook ─────────────────────────────────────────────────────────────

export function useSettings(): SettingsContextValue {
    const ctx = useContext(SettingsContext);
    if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
    return ctx;
}

export { genId };
