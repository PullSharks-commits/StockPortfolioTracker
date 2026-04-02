export const getCurrencySymbol = (currencyCode: string) => {
  if (currencyCode === 'INR') return '₹';
  if (currencyCode === 'AUD') return 'A$';
  if (currencyCode === 'EUR') return '€';
  if (currencyCode === 'GBP') return '£';
  if (currencyCode === 'JPY') return '¥';
  if (currencyCode === 'CAD') return 'C$';
  if (currencyCode === 'SGD') return 'S$';
  if (currencyCode === 'CHF') return 'CHF ';
  if (currencyCode === 'HKD') return 'HK$';
  if (currencyCode === 'NZD') return 'NZ$';
  return '$'; // Default to USD
};

export const formatCurrency = (value: number, currencyCode: string, includeSign = false, maximumFractionDigits = 2) => {
  const symbol = getCurrencySymbol(currencyCode);
  const formatted = Math.abs(value).toLocaleString(undefined, { 
    minimumFractionDigits: maximumFractionDigits > 0 ? 2 : 0, 
    maximumFractionDigits 
  });
  const sign = value < 0 ? '-' : (includeSign && value > 0 ? '+' : '');
  return `${sign}${symbol}${formatted}`;
};

