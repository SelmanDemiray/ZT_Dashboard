import type {
    TenantIndex,
    ZeroTrust,
    PolicyCompliance,
    DefenderRecs,
    Governance,
    StorageAccountsData,
    FinOpsData,
    RunSnapshot,
} from '@/types/assessment';

const BLOB_BASE_URL = import.meta.env.VITE_BLOB_BASE_URL ?? '';
const BLOB_SAS_TOKEN = import.meta.env.VITE_BLOB_SAS_TOKEN ?? '';

// ─── In-memory fetch cache (deduplicates concurrent & repeated requests) ─────
const fetchCache = new Map<string, Promise<unknown>>();

function buildUrl(path: string): string {
    if (!BLOB_BASE_URL) {
        throw new Error("VITE_BLOB_BASE_URL is not defined in the environment. Real data cannot be loaded.");
    }
    const base = `${BLOB_BASE_URL}/assessments/${path}`;
    if (!BLOB_SAS_TOKEN) return base;
    const separator = BLOB_SAS_TOKEN.startsWith('?') ? '' : '?';
    return `${base}${separator}${BLOB_SAS_TOKEN}`;
}

async function fetchJson<T>(path: string, noCache = false): Promise<T> {
    let url = buildUrl(path);

    // Add cache buster for the index file so we always see new daily runs
    if (noCache) {
        const char = url.includes('?') ? '&' : '?';
        url += `${char}t=${new Date().getTime()}`;
    }

    // Return cached promise for cacheable requests
    if (!noCache && fetchCache.has(url)) {
        return fetchCache.get(url) as Promise<T>;
    }

    const promise = (async () => {
        const res = await fetch(url, {
            cache: noCache ? 'no-store' : 'default',
            headers: noCache ? { 'Cache-Control': 'no-cache' } : undefined
        });

        if (!res.ok) {
            throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<T>;
    })();

    // Cache only non-noCache requests
    if (!noCache) {
        fetchCache.set(url, promise);
        // Evict on failure so retries work
        promise.catch(() => fetchCache.delete(url));
    }

    return promise;
}

export async function fetchTenantIndex(): Promise<TenantIndex> {
    // We strictly bypass cache for the index so we always get the latest dates
    return fetchJson<TenantIndex>('tenant-index.json', true);
}

export async function fetchZeroTrust(
    tenantId: string,
    subscriptionId: string,
    date: string,
    noCache = false
): Promise<ZeroTrust> {
    return fetchJson<ZeroTrust>(
        `${tenantId}/${subscriptionId}/${date}/zero-trust.json`,
        noCache
    );
}

export async function fetchPolicyCompliance(
    tenantId: string,
    subscriptionId: string,
    date: string,
    noCache = false
): Promise<PolicyCompliance> {
    return fetchJson<PolicyCompliance>(
        `${tenantId}/${subscriptionId}/${date}/policy-compliance.json`,
        noCache
    );
}

export async function fetchPolicyMapping(
    tenantId: string,
    noCache = false
): Promise<{ mapping: Record<string, string> }> {
    try {
        return await fetchJson<{ mapping: Record<string, string> }>(
            `${tenantId}/policy-mapping.json`,
            noCache
        );
    } catch {
        // Fallback to empty if not generated yet by playbook
        return { mapping: {} };
    }
}

export async function fetchDefenderRecs(
    tenantId: string,
    subscriptionId: string,
    date: string,
    noCache = false
): Promise<DefenderRecs> {
    return fetchJson<DefenderRecs>(
        `${tenantId}/${subscriptionId}/${date}/defender-recs.json`,
        noCache
    );
}

export async function fetchGovernance(
    tenantId: string,
    subscriptionId: string,
    date: string,
    noCache = false
): Promise<Governance> {
    return fetchJson<Governance>(
        `${tenantId}/${subscriptionId}/${date}/governance.json`,
        noCache
    );
}

export async function fetchStorageAccounts(
    tenantId: string,
    subscriptionId: string,
    date: string,
    noCache = false
): Promise<StorageAccountsData> {
    return fetchJson<StorageAccountsData>(
        `${tenantId}/${subscriptionId}/${date}/storage-accounts.json`,
        noCache
    );
}

export async function fetchFinOps(
    tenantId: string,
    subscriptionId: string,
    date: string,
    noCache = false
): Promise<FinOpsData> {
    return fetchJson<FinOpsData>(
        `${tenantId}/${subscriptionId}/${date}/finops.json`,
        noCache
    );
}

// ─── Default empty objects for missing data files ─────────────────────────────

const EMPTY_ZERO_TRUST: ZeroTrust = {
    tenantId: '', tenantName: '', runDate: '', overallScore: 0, pillars: [], checks: [],
};

const EMPTY_POLICY_COMPLIANCE: PolicyCompliance = {
    runDate: '', initiatives: [],
};

const EMPTY_DEFENDER_RECS: DefenderRecs = {
    runDate: '', recommendations: [],
};

const EMPTY_GOVERNANCE: Governance = {
    runDate: '', rules: [],
};

const EMPTY_STORAGE_ACCOUNTS: StorageAccountsData = {
    runDate: '', accounts: [],
};

const EMPTY_FINOPS: FinOpsData = {
    runDate: '',
    serviceCosts: [],
    subscriptionCosts: [],
    teamCosts: [],
    dailyCostData: [],
    weeklyCostData: [],
    monthlyCostData: [],
    costAnomalies: [],
    savingsRecommendations: [],
};

export async function fetchRunSnapshot(
    tenantId: string,
    subscriptionId: string,
    date: string
): Promise<RunSnapshot> {
    // Use `allSettled` so a single missing file (e.g. zero-trust.json returning 404)
    // doesn't crash the entire snapshot — partial data is better than no data.
    const noCache = date === 'latest';
    const results = await Promise.allSettled([
        fetchZeroTrust(tenantId, subscriptionId, date, noCache),
        fetchPolicyCompliance(tenantId, subscriptionId, date, noCache),
        fetchDefenderRecs(tenantId, subscriptionId, date, noCache),
        fetchGovernance(tenantId, subscriptionId, date, noCache),
        fetchStorageAccounts(tenantId, subscriptionId, date, noCache),
        fetchFinOps(tenantId, subscriptionId, date, noCache),
    ]);

    const zeroTrust = results[0].status === 'fulfilled' ? results[0].value : { ...EMPTY_ZERO_TRUST, tenantId, runDate: date };
    const policyCompliance = results[1].status === 'fulfilled' ? results[1].value : { ...EMPTY_POLICY_COMPLIANCE, runDate: date };
    const defenderRecs = results[2].status === 'fulfilled' ? results[2].value : { ...EMPTY_DEFENDER_RECS, runDate: date };
    const governance = results[3].status === 'fulfilled' ? results[3].value : { ...EMPTY_GOVERNANCE, runDate: date };
    const storageAccounts = results[4].status === 'fulfilled' ? results[4].value : { ...EMPTY_STORAGE_ACCOUNTS, runDate: date };
    const finops = results[5].status === 'fulfilled' ? results[5].value : { ...EMPTY_FINOPS, runDate: date };

    // If ALL files failed, throw so callers know there's truly no data
    if (results.every(r => r.status === 'rejected')) {
        throw new Error(`All data files missing for ${tenantId}/${subscriptionId}/${date}`);
    }

    return { date, zeroTrust, policyCompliance, defenderRecs, governance, storageAccounts, finops };
}

export async function fetchAllSnapshots(
    tenantId: string,
    subscriptionId: string,
    dates: string[]
): Promise<RunSnapshot[]> {
    // Use allSettled so individual date failures don't kill the entire list
    const results = await Promise.allSettled(
        dates.map((d) => fetchRunSnapshot(tenantId, subscriptionId, d))
    );

    const snapshots = results
        .filter((r): r is PromiseFulfilledResult<RunSnapshot> => r.status === 'fulfilled')
        .map(r => r.value);

    return snapshots.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
}
