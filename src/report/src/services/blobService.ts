import type {
    TenantIndex,
    ZeroTrust,
    PolicyCompliance,
    DefenderRecs,
    Governance,
    RunSnapshot,
} from '@/types/assessment';

const BLOB_BASE_URL = import.meta.env.VITE_BLOB_BASE_URL ?? '';
const BLOB_SAS_TOKEN = import.meta.env.VITE_BLOB_SAS_TOKEN ?? '';

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

    const res = await fetch(url, {
        cache: noCache ? 'no-store' : 'default',
        headers: noCache ? { 'Cache-Control': 'no-cache' } : undefined
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
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

export async function fetchRunSnapshot(
    tenantId: string,
    subscriptionId: string,
    date: string
): Promise<RunSnapshot> {
    // The `latest/*` URLs are constant over time, so browser/proxy caching can cause stale data
    // unless we explicitly bypass cache for those requests.
    const noCache = date === 'latest';
    const [zeroTrust, policyCompliance, defenderRecs, governance] =
        await Promise.all([
            fetchZeroTrust(tenantId, subscriptionId, date, noCache),
            fetchPolicyCompliance(tenantId, subscriptionId, date, noCache),
            fetchDefenderRecs(tenantId, subscriptionId, date, noCache),
            fetchGovernance(tenantId, subscriptionId, date, noCache),
        ]);

    return { date, zeroTrust, policyCompliance, defenderRecs, governance };
}

export async function fetchAllSnapshots(
    tenantId: string,
    subscriptionId: string,
    dates: string[]
): Promise<RunSnapshot[]> {
    const snapshots = await Promise.all(
        dates.map((d) => fetchRunSnapshot(tenantId, subscriptionId, d))
    );
    return snapshots.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
}
