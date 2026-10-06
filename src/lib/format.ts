export function formatMoney(amountMinor: number, currencyCode = 'INR') { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currencyCode, maximumFractionDigits: 2 }).format(amountMinor / 100); }
export function formatDate(date: string) { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`)); }
export function toMinor(value: string): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0; }
