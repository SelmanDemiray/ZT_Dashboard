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
    const separator = BLOB_SAS_TOKEN.startsWith('?') ? '' : '?';
    return `${BLOB_BASE_URL}/assessments/${path}${separator}${BLOB_SAS_TOKEN}`;
}

async function fetchJson<T>(path: string): Promise<T> {
    const url = buildUrl(path);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
}

export async function fetchTenantIndex(): Promise<TenantIndex> {
    return fetchJson<TenantIndex>('tenant-index.json');
}

export async function fetchZeroTrust(
    tenantId: string,
    subscriptionId: string,
    date: string
): Promise<ZeroTrust> {
    return fetchJson<ZeroTrust>(
        `${tenantId}/${subscriptionId}/${date}/zero-trust.json`
    );
}

export async function fetchPolicyCompliance(
    tenantId: string,
    subscriptionId: string,
    date: string
): Promise<PolicyCompliance> {
    return fetchJson<PolicyCompliance>(
        `${tenantId}/${subscriptionId}/${date}/policy-compliance.json`
    );
}

export async function fetchDefenderRecs(
    tenantId: string,
    subscriptionId: string,
    date: string
): Promise<DefenderRecs> {
    return fetchJson<DefenderRecs>(
        `${tenantId}/${subscriptionId}/${date}/defender-recs.json`
    );
}

export async function fetchGovernance(
    tenantId: string,
    subscriptionId: string,
    date: string
): Promise<Governance> {
    return fetchJson<Governance>(
        `${tenantId}/${subscriptionId}/${date}/governance.json`
    );
}

export async function fetchRunSnapshot(
    tenantId: string,
    subscriptionId: string,
    date: string
): Promise<RunSnapshot> {
    const [zeroTrust, policyCompliance, defenderRecs, governance] =
        await Promise.all([
            fetchZeroTrust(tenantId, subscriptionId, date),
            fetchPolicyCompliance(tenantId, subscriptionId, date),
            fetchDefenderRecs(tenantId, subscriptionId, date),
            fetchGovernance(tenantId, subscriptionId, date),
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
