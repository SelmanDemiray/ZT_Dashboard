import type { ZeroTrustAssessmentReport } from '@/config/report-data';

const BLOB_BASE_URL = import.meta.env.VITE_BLOB_BASE_URL ?? '';
const BLOB_SAS_TOKEN = import.meta.env.VITE_BLOB_SAS_TOKEN ?? '';

function buildUrl(path: string): string {
    if (!BLOB_BASE_URL) {
        throw new Error("VITE_BLOB_BASE_URL is not defined. Cannot load live report data.");
    }
    const base = `${BLOB_BASE_URL}/${path}`;
    if (!BLOB_SAS_TOKEN) return base;
    const separator = BLOB_SAS_TOKEN.startsWith('?') ? '' : '?';
    return `${base}${separator}${BLOB_SAS_TOKEN}`;
}

/**
 * Fetches the full ZeroTrustAssessmentReport from blob storage.
 * The runbook uploads this as `assessments/report-data.json`.
 * Always bypasses cache so the latest daily run is picked up.
 */
export async function fetchReportData(): Promise<ZeroTrustAssessmentReport> {
    let url = buildUrl('assessments/report-data.json');
    // Cache-bust so we always pick up the latest daily run
    const char = url.includes('?') ? '&' : '?';
    url += `${char}t=${new Date().getTime()}`;

    const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch report-data.json: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<ZeroTrustAssessmentReport>;
}
