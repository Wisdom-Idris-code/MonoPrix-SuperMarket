export const DEFAULT_DELIVERY_FEE = '50.00';

export function formatSLE(value: number | string): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 'NLe 0.00';
  }
  return `NLe ${numeric.toLocaleString('en-SL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
