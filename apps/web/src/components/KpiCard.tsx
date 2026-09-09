import { cn } from '@/lib/utils';

export function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'card p-5 transition hover:-translate-y-0.5 hover:shadow-lift',
        accent && 'border-primary/20 bg-gradient-to-br from-primary/5 to-white'
      )}
    >
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
