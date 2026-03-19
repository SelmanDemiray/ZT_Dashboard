export function getMappedPolicyName(
    id: string,
    originalName: string,
    mapping: Record<string, string>
): string {
    if (!mapping) return originalName;

    // Check by ID (usually a GUID or lowercased resource ID)
    const idLower = id.toLowerCase();
    if (mapping[idLower]) {
        return mapping[idLower];
    }

    // Sometimes the 'originalName' is actually the GUID we want to look up
    const nameLower = originalName.toLowerCase();
    if (mapping[nameLower]) {
        return mapping[nameLower];
    }

    return originalName;
}
