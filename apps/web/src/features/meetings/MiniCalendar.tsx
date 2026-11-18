import { useMemo } from 'react';
import { weekdayPtBRShort, monthNamePtBRLong } from '@agenda/shared';
import { addDaysKey, monthKeyOf, todayKey } from '../../lib/format';

export type MiniCalendarProps = {
  /** Mês visível (aaaa-mm). */
  monthKey: string;
  /** Dia selecionado (aaaa-mm-dd) ou null. */
  selected: string | null;
  /** Contagem de reuniões por dia (aaaa-mm-dd → quantidade). */
  counts: Record<string, number>;
  onMonthChange: (monthKey: string) => void;
  onSelect: (dateKey: string) => void;
};

/**
 * Calendário mensal compacto em pt-BR.
 * Dias com reuniões exibem indicador discreto com a quantidade.
 */
export default function MiniCalendar({
  monthKey,
  selected,
  counts,
  onMonthChange,
  onSelect,
}: MiniCalendarProps) {
  const today = todayKey();

  const grid = useMemo(() => {
    const [yearStr, monthStr] = monthKey.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr); // 1-12
    const first = new Date(Date.UTC(year, month - 1, 1));
    const startWeekday = first.getUTCDay(); // 0=dom

    const cells: Array<{ dateKey: string; day: number; inMonth: boolean }> = [];
    const start = addDaysKey(`${monthKey}-01`, -startWeekday);
    for (let i = 0; i < 42; i += 1) {
      const dateKey = addDaysKey(start, i);
      const day = Number(dateKey.slice(8, 10));
      cells.push({ dateKey, day, inMonth: dateKey.slice(0, 7) === monthKey });
      if (cells.length >= 35 && Number(dateKey.slice(5, 7)) !== month && i >= 34) break;
    }
    return cells;
  }, [monthKey]);

  const shiftMonth = (delta: number): void => {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + delta, 1));
    onMonthChange(monthKeyOf(d));
  };

  const [yearLabel, monthLabel] = monthKey.split('-');
  const monthIndex = Number(monthLabel) - 1;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Mês anterior"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          ‹
        </button>
        <div className="text-sm font-semibold capitalize text-navy-900">
          {monthNamePtBRLong(monthIndex)} <span className="font-normal text-slate-500">{yearLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Próximo mês"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {[2, 3, 4, 5, 6, 0, 1].map((wd) => (
          <div key={wd} className="py-1 text-[10px] font-semibold uppercase text-slate-400">
            {weekdayPtBRShort(wd).slice(0, 3)}
          </div>
        ))}
        {grid.map((cell) => {
          const count = counts[cell.dateKey] ?? 0;
          const isSelected = selected === cell.dateKey;
          const isToday = cell.dateKey === today;
          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() => onSelect(cell.dateKey)}
              aria-pressed={isSelected}
              aria-label={`${cell.day} de ${monthNamePtBRLong(Number(cell.dateKey.slice(5, 7)) - 1)}`}
              className={[
                'relative flex h-9 flex-col items-center justify-center rounded-lg text-sm transition',
                isSelected
                  ? 'bg-brand-700 font-semibold text-white shadow'
                  : isToday
                    ? 'bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-600/40'
                    : cell.inMonth
                      ? 'text-slate-700 hover:bg-slate-100'
                      : 'text-slate-300 hover:bg-slate-50',
              ].join(' ')}
            >
              <span className="leading-none">{cell.day}</span>
              {count > 0 && (
                <span
                  className={[
                    'mt-0.5 h-1 w-1 rounded-full',
                    isSelected ? 'bg-white' : count > 2 ? 'bg-brand-700' : 'bg-brand-500',
                  ].join(' ')}
                  aria-label={`${count} reunião(ões)`}
                />
              )}
              {count > 0 && (
                <span className="sr-only">{count} reuniões neste dia</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        <span>
          {selected ? `Selecionado: ${selected.slice(8)}/${selected.slice(5, 7)}` : 'Selecione um dia'}
        </span>
        <button
          type="button"
          onClick={() => {
            onMonthChange(monthKeyOf(new Date()));
            onSelect(todayKey());
          }}
          className="font-medium text-brand-700 hover:underline"
        >
          Hoje
        </button>
      </div>
    </div>
  );
}
