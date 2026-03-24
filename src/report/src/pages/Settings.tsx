import React, { useState } from 'react';
import { useSettings, type FilterGroup } from '@/contexts/SettingsContext';
import { useGlobalFilters } from '@/contexts/GlobalFilterContext';
import { Settings as SettingsIcon, Plus, Trash2, X, Pencil, Check, Layers, Users, Hash, AlertCircle } from 'lucide-react';

type GroupCategory = 'operationalAreas' | 'teams' | 'keywords';

interface TabConfig {
    key: GroupCategory;
    label: string;
    icon: typeof SettingsIcon;
    color: string;
    bg: string;
    description: string;
    placeholder: string;
    itemPlaceholder: string;
}

const TABS: TabConfig[] = [
    {
        key: 'operationalAreas',
        label: 'Operational Areas',
        icon: Layers,
        color: '#3b82f6',
        bg: 'from-blue-500/15 to-cyan-500/15',
        description: 'Group security tests by pillars or domains (e.g. Identity, Devices, Network)',
        placeholder: 'e.g. Cloud Infrastructure',
        itemPlaceholder: 'e.g. Identity',
    },
    {
        key: 'teams',
        label: 'Teams',
        icon: Users,
        color: '#8b5cf6',
        bg: 'from-violet-500/15 to-purple-500/15',
        description: 'Organize by team or department for scoped views',
        placeholder: 'e.g. Security Operations',
        itemPlaceholder: 'e.g. SOC-Team-Alpha',
    },
    {
        key: 'keywords',
        label: 'Keywords',
        icon: Hash,
        color: '#f59e0b',
        bg: 'from-amber-500/15 to-orange-500/15',
        description: 'Create keyword groups to filter tests by title/description content',
        placeholder: 'e.g. MFA Policies',
        itemPlaceholder: 'e.g. multi-factor',
    },
];

export default function Settings() {
    const [activeTab, setActiveTab] = useState<GroupCategory>('operationalAreas');
    const tab = TABS.find((t) => t.key === activeTab)!;

    return (
        <div className="w-full flex max-w-7xl flex-col gap-6 mt-12">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 ring-1 ring-indigo-500/20">
                    <SettingsIcon className="size-5 text-indigo-500" />
                </div>
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Filter Settings</h1>
                    <p className="text-xs text-muted-foreground">
                        Define operational areas, teams, and keyword groups used across the dashboard filters
                    </p>
                </div>
            </div>

            {/* Tab Bar */}
            <div className="flex gap-2 border-b border-border/40 pb-0">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const isActive = activeTab === t.key;
                    return (
                        <button
                            key={t.key}
                            onClick={() => setActiveTab(t.key)}
                            className={`
                                flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl transition-all duration-200
                                ${isActive
                                    ? 'bg-gradient-to-br ' + t.bg + ' text-foreground border border-b-0 border-border/40 shadow-sm -mb-px'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                }
                            `}
                        >
                            <Icon className="size-4" style={{ color: isActive ? t.color : undefined }} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300" key={activeTab}>
                <p className="text-sm text-muted-foreground mb-4">{tab.description}</p>
                <GroupManager tab={tab} />
            </div>
        </div>
    );
}

// ─── Group Manager ────────────────────────────────────────────────────

function GroupManager({ tab }: { tab: TabConfig }) {
    const { settings, addGroup, deleteGroup, renameGroup, addItem, removeItem, addLinkItem, removeLinkItem } = useSettings();
    const { availableSubscriptions } = useGlobalFilters();
    const allResourceGroups = React.useMemo(() => {
        const set = new Set<string>();
        availableSubscriptions.forEach(sub => sub.resourceGroups?.forEach(rg => set.add(rg)));
        return Array.from(set);
    }, [availableSubscriptions]);

    const [newGroupName, setNewGroupName] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const groups = settings[tab.key];

    const handleAddGroup = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newGroupName.trim();
        if (!trimmed) return;
        addGroup(tab.key, trimmed);
        setNewGroupName('');
    };

    return (
        <div className="space-y-4">
            {/* Add Group Form */}
            <form onSubmit={handleAddGroup} className="flex gap-2">
                <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder={tab.placeholder}
                    className="flex-1 h-10 px-3 rounded-xl bg-muted/50 border border-border/60 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                />
                <button
                    type="submit"
                    disabled={!newGroupName.trim()}
                    className="h-10 px-4 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-sm font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40 transition-all duration-200 shadow-sm"
                >
                    <Plus className="size-4" />
                    Add Group
                </button>
            </form>

            {/* Groups List */}
            {groups.length === 0 && (
                <div className="glass-card gradient-border p-8 text-center">
                    <AlertCircle className="size-8 text-muted-foreground mx-auto mb-2 opacity-30" />
                    <p className="text-sm text-muted-foreground">
                        No {tab.label.toLowerCase()} defined yet. Add one above.
                    </p>
                </div>
            )}

            <div className="grid gap-3">
                {groups.map((group) => (
                    <GroupCard
                        key={group.id}
                        group={group}
                        tab={tab}
                        onRename={(name) => renameGroup(tab.key, group.id, name)}
                        onDelete={() => {
                            if (confirmDeleteId === group.id) {
                                deleteGroup(tab.key, group.id);
                                setConfirmDeleteId(null);
                            } else {
                                setConfirmDeleteId(group.id);
                                setTimeout(() => setConfirmDeleteId(null), 3000);
                            }
                        }}
                        confirmingDelete={confirmDeleteId === group.id}
                        onAddItem={(val) => addItem(tab.key, group.id, val)}
                        onRemoveItem={(val) => removeItem(tab.key, group.id, val)}
                        onAddSub={(val) => addLinkItem(tab.key, group.id, 'subscriptions', val)}
                        onRemoveSub={(val) => removeLinkItem(tab.key, group.id, 'subscriptions', val)}
                        onAddRg={(val) => addLinkItem(tab.key, group.id, 'resourceGroups', val)}
                        onRemoveRg={(val) => removeLinkItem(tab.key, group.id, 'resourceGroups', val)}
                        availableSubscriptions={availableSubscriptions}
                        allResourceGroups={allResourceGroups}
                    />
                ))}
            </div>
        </div>
    );
}

// ─── Group Card ───────────────────────────────────────────────────────

interface GroupCardProps {
    group: FilterGroup;
    tab: TabConfig;
    onRename: (name: string) => void;
    onDelete: () => void;
    confirmingDelete: boolean;
    onAddItem: (value: string) => void;
    onRemoveItem: (value: string) => void;
    onAddSub: (value: string) => void;
    onRemoveSub: (value: string) => void;
    onAddRg: (value: string) => void;
    onRemoveRg: (value: string) => void;
    availableSubscriptions: { id: string; name: string }[];
    allResourceGroups: string[];
}

function GroupCard({ group, tab, onRename, onDelete, confirmingDelete, onAddItem, onRemoveItem, onAddSub, onRemoveSub, onAddRg, onRemoveRg, availableSubscriptions, allResourceGroups }: GroupCardProps) {
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState(group.name);

    const handleSaveName = () => {
        const trimmed = editName.trim();
        if (trimmed && trimmed !== group.name) {
            onRename(trimmed);
        }
        setEditing(false);
    };

    return (
        <div className="glass-card gradient-border p-5 space-y-3 hover:shadow-lg transition-shadow duration-200">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {editing ? (
                        <div className="flex items-center gap-1.5">
                            <input
                                autoFocus
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditing(false); }}
                                className="h-8 px-2 rounded-lg bg-muted/50 border border-border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                            <button onClick={handleSaveName} className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-emerald-500 transition-colors">
                                <Check className="size-3.5" />
                            </button>
                            <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                                <X className="size-3.5" />
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="p-1.5 rounded-lg" style={{ background: `${tab.color}18` }}>
                                <tab.icon className="size-3.5" style={{ color: tab.color }} />
                            </div>
                            <h3 className="text-sm font-semibold">{group.name}</h3>
                            <button onClick={() => { setEditName(group.name); setEditing(true); }} className="p-1 rounded-md hover:bg-muted text-muted-foreground transition-colors">
                                <Pencil className="size-3" />
                            </button>
                        </>
                    )}
                </div>
                <button
                    onClick={onDelete}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-all duration-200 ${
                        confirmingDelete
                            ? 'bg-red-500/20 text-red-500 ring-1 ring-red-500/40'
                            : 'hover:bg-red-500/10 text-muted-foreground hover:text-red-500'
                    }`}
                >
                    <Trash2 className="size-3" />
                    {confirmingDelete ? 'Confirm?' : 'Delete'}
                </button>
            </div>

            <div className="space-y-4">
                <GroupSection
                    title="Match Values (Tags, Titles, Desc)"
                    items={group.values}
                    placeholder={tab.itemPlaceholder}
                    onAdd={onAddItem}
                    onRemove={onRemoveItem}
                />
                <GroupSection
                    title="Linked Subscriptions"
                    items={group.subscriptions || []}
                    placeholder="e.g. 00000000-0000-0000-0000-000000000000"
                    onAdd={onAddSub}
                    onRemove={onRemoveSub}
                    datalistId={`dl-sub-${group.id}`}
                    options={availableSubscriptions.map(s => ({ value: s.id, label: s.name }))}
                />
                <GroupSection
                    title="Linked Resource Groups"
                    items={group.resourceGroups || []}
                    placeholder="e.g. core-infra-rg"
                    onAdd={onAddRg}
                    onRemove={onRemoveRg}
                    datalistId={`dl-rg-${group.id}`}
                    options={allResourceGroups.map(rg => ({ value: rg, label: rg }))}
                />
            </div>
        </div>
    );
}

function GroupSection({
    title,
    items,
    placeholder,
    onAdd,
    onRemove,
    datalistId,
    options,
}: {
    title: string;
    items: string[];
    placeholder: string;
    onAdd: (val: string) => void;
    onRemove: (val: string) => void;
    datalistId?: string;
    options?: { value: string; label: string }[];
}) {
    const [newItem, setNewItem] = useState('');
    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newItem.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        setNewItem('');
    };

    return (
        <div className="space-y-2 pt-2 border-t border-border/30">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
            <div className="flex flex-wrap gap-1.5">
                {items.map((val) => (
                    <span key={val} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted/60 text-foreground/80 border border-border/40 hover:border-border transition-colors group">
                        {val}
                        <button type="button" onClick={() => onRemove(val)} className="p-0.5 rounded-full hover:bg-red-500/20 hover:text-red-500 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-all">
                            <X className="size-2.5" />
                        </button>
                    </span>
                ))}
                {items.length === 0 && <span className="text-xs text-muted-foreground/50 italic">None</span>}
            </div>
            <form onSubmit={handleAdd} className="flex gap-1.5">
                <input
                    list={datalistId}
                    type="text"
                    value={newItem}
                    onChange={(e) => setNewItem(e.target.value)}
                    placeholder={placeholder}
                    className="flex-1 h-8 px-2.5 rounded-lg bg-muted/30 border border-border/40 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                />
                {datalistId && options && (
                    <datalist id={datalistId}>
                        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </datalist>
                )}
                <button
                    type="submit"
                    disabled={!newItem.trim()}
                    className="h-8 px-3 rounded-lg text-xs font-medium bg-muted/50 hover:bg-muted text-foreground/70 disabled:opacity-30 flex items-center gap-1 transition-all"
                >
                    <Plus className="size-3" /> Add
                </button>
            </form>
        </div>
    );
}
