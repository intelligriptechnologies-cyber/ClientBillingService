'use client';

const months = Array.from({ length: 12 }, (_, index) => ({
  number: String(index + 1).padStart(2, '0'),
  label: new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2024, index, 1)),
}));

export function MonthYearFilter({ value, onChange, label = 'Month and year' }: { value: string; onChange(value: string): void; label?: string }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: Math.max(currentYear + 3 - 2000, 1) }, (_, index) => currentYear + 2 - index);
  return <select className="select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">All months</option>
    {years.map((year) => <optgroup key={year} label={String(year)}>{months.map((month) => <option key={`${year}-${month.number}`} value={`${year}-${month.number}`}>{month.label} {year}</option>)}</optgroup>)}
  </select>;
}
