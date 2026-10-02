export type ReportingPeriod = "rolling" | number;

export function ReportingPeriodSelect({ value, onChange, className }: { value: ReportingPeriod; onChange: (value: ReportingPeriod) => void; className: string }) {
  return <label className={className}>Reporting period <select aria-label="Reporting period" value={value} onChange={event => onChange(event.target.value === "rolling" ? "rolling" : Number(event.target.value))}>
    <option value="rolling">This rolling period · card renewal dates</option>
    {Array.from({ length: new Date().getFullYear() - 2019 }, (_, index) => new Date().getFullYear() - index).map(year => <option key={year} value={year}>Calendar {year} · bookkeeping</option>)}
  </select></label>;
}
