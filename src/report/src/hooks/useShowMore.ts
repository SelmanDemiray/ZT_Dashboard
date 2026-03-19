import { useState, useCallback } from 'react';

/**
 * Hook for progressive "Show More" pagination in card lists.
 * Returns the current limit, a function to show more items,
 * a reset, and a boolean indicating if all items are shown.
 */
export function useShowMore(pageSize = 25) {
    const [limit, setLimit] = useState(pageSize);
    const showMore = useCallback(() => setLimit(l => l + pageSize), [pageSize]);
    const reset = useCallback(() => setLimit(pageSize), [pageSize]);

    return {
        limit,
        showMore,
        reset,
        hasMore: (total: number) => limit < total,
    };
}
