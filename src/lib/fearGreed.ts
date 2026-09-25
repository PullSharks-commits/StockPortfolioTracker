export interface GroupFearGreedResult {
  score: number;
  rating: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
  colorClass: string;
  badgeBgClass: string;
  borderClass: string;
  count: number;
}

export const getFearGreedRating = (score: number) => {
  if (score <= 25) {
    return {
      rating: 'Extreme Fear' as const,
      colorClass: 'text-rose-600',
      badgeBgClass: 'bg-rose-50',
      borderClass: 'border-rose-200/70',
      bgSolid: 'bg-rose-500'
    };
  }
  if (score <= 45) {
    return {
      rating: 'Fear' as const,
      colorClass: 'text-orange-600',
      badgeBgClass: 'bg-orange-50',
      borderClass: 'border-orange-200/70',
      bgSolid: 'bg-orange-500'
    };
  }
  if (score <= 55) {
    return {
      rating: 'Neutral' as const,
      colorClass: 'text-zinc-600',
      badgeBgClass: 'bg-zinc-50',
      borderClass: 'border-zinc-200/70',
      bgSolid: 'bg-zinc-500'
    };
  }
  if (score <= 75) {
    return {
      rating: 'Greed' as const,
      colorClass: 'text-emerald-600',
      badgeBgClass: 'bg-emerald-50',
      borderClass: 'border-emerald-200/70',
      bgSolid: 'bg-emerald-500'
    };
  }
  return {
    rating: 'Extreme Greed' as const,
    colorClass: 'text-blue-600',
    badgeBgClass: 'bg-blue-50',
    borderClass: 'border-blue-200/70',
    bgSolid: 'bg-blue-500'
  };
};

export const calculateGroupFearGreed = (
  holdingsList: any[],
  fearGreedData: { details?: any[] } | null | undefined
): GroupFearGreedResult | null => {
  if (!fearGreedData || !Array.isArray(fearGreedData.details) || fearGreedData.details.length === 0) {
    return null;
  }
  if (!holdingsList || holdingsList.length === 0) return null;

  const validHoldings = holdingsList.filter(h => h && h.ticker && h.ticker !== 'CASH');
  if (validHoldings.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  let scoreSum = 0;
  let count = 0;

  validHoldings.forEach(h => {
    const detail = fearGreedData.details?.find(
      (d: any) => d && d.symbol && h && h.ticker && String(d.symbol).toUpperCase() === String(h.ticker).toUpperCase()
    );
    if (detail && typeof detail.score === 'number' && !isNaN(detail.score)) {
      const weight = Math.max(h.currentValue || 0, 1);
      weightedSum += detail.score * weight;
      totalWeight += weight;
      scoreSum += detail.score;
      count++;
    }
  });

  if (count === 0) return null;

  const avgScore = totalWeight > 0 ? weightedSum / totalWeight : scoreSum / count;
  const roundedScore = Math.round(avgScore);
  const ratingInfo = getFearGreedRating(roundedScore);

  return {
    score: roundedScore,
    rating: ratingInfo.rating,
    colorClass: ratingInfo.colorClass,
    badgeBgClass: ratingInfo.badgeBgClass,
    borderClass: ratingInfo.borderClass,
    count
  };
};

export const getGroupFearGreedMap = (
  groupedHoldings: Record<string, { holdings: any[] }>,
  fearGreedData: { details?: any[] } | null | undefined
): Record<string, GroupFearGreedResult | null> => {
  const map: Record<string, GroupFearGreedResult | null> = {};
  if (!groupedHoldings) return map;

  Object.entries(groupedHoldings).forEach(([groupName, groupData]) => {
    map[groupName] = calculateGroupFearGreed(groupData.holdings || [], fearGreedData);
  });

  return map;
};
