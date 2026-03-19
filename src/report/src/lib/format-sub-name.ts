import type { TenantSubscription } from '@/types/assessment';

/**
 * Returns a human-readable display name for a subscription.
 * Falls back to a truncated ID if the name field is empty/undefined.
 */
export function displaySubName(sub: TenantSubscription): string {
    if (sub.name && sub.name.trim()) return sub.name;
    return `Sub: ${sub.id.slice(0, 8)}…`;
}
