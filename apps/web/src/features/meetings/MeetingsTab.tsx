import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Meeting, Paginated, SessionUser } from '@agenda/shared';
import { api, qs } from '../../lib/api';
import { Avatar, Badge, Drawer, EmptyState, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';
import MiniCalendar from './MiniCalendar';
import MeetingFormDrawer from './MeetingFormDrawer';
import MeetingDetailDrawer from './MeetingDetailDrawer';
import {
  addDaysKey,
  formatClock,
  formatClockRange,
  formatDay,
  formatDuration,
  monthName,
  monthKeyOf,
  todayKey,
} from '../../lib/format';

type MetricsResponse = {
  month: string;
  monthCount: number;
  today: number;
  todayNext: Meeting | null;
  upcoming: number;
  upcomingNext: Meeting | null;
  createdByMe: number;
  total: number;
  cancelled: number;
};

type Filters = {
  from: string;
  to: string;
  status: 'ALL' | 'SCHEDULED' | 'CANCELLED';
  createdByMe: boolean;
  q: string;
};

const EMPTY_FILTERS: Filters = { from: '', to: '', status: 'ALL', createdByMe: false, q: '' };
const PAGE_SIZE = 15;

type KpiKind = 'today' | 'upcoming' | 'month' | 'mine';

export default function MeetingsTab({
  currentUser,
  openMeetingId,
  onOpenMeetingConsumed,
}: {
  currentUser: SessionUser;
  openMeetingId: string | null;
  onOpenMeetingConsumed: () => void;
}) {
  const toast = useToast();

  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cursorMonth, setCursorMonth] = useState<string>(() => monthKeyOf(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayAgenda, setDayAgenda] = useState<Meeting[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Meeting[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [kpiOpen, setKpiOpen] = useState<KpiKind | null>(null);

  const today = todayKey();

  /* --------------------------------- Carga -------------------------------- */
  const loadMetrics = useCallback(async () => {
    try {
      const r = await api<MetricsResponse>(`/api/v1/dashboard/meeting-metrics${qs({ month: cursorMonth })}`);
      setMetrics(r);
    } catch {
      /* erros de KPI não devem derrubar a tela */
    }
  }, [cursorMonth]);

  const loadCounts = useCallback(async () => {
    try {
      const r = await api<{ counts: Record<string, number> }>(
        `/api/v1/dashboard/month-counts${qs({ month: cursorMonth })}`,
      );
      setCounts(r.counts);
    } catch {
      /* ignorado */
    }
  }, [cursorMonth]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const r = await api<Paginated<Meeting>>(
        `/api/v1/meetings${qs({
          from: filters.from,
          to: filters.to,
          status: filters.status,
          createdByMe: filters.createdByMe ? 'true' : '',
          q: filters.q,
          page,
          pageSize: PAGE_SIZE,
        })}`,
      );
      setItems(r.items);
      setTotal(r.total);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Falha ao carregar reuniões.');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const loadDayAgenda = useCallback(async () => {
    if (!selectedDay) {
      setDayAgenda([]);
      return;
    }
    setDayLoading(true);
    try {
      const r = await api<Paginated<Meeting>>(
        `/api/v1/meetings${qs({ from: selectedDay, to: selectedDay, pageSize: 50 })}`,
      );
      setDayAgenda(r.items);
    } catch {
      setDayAgenda([]);
    } finally {
      setDayLoading(false);
    }
  }, [selectedDay]);

  useEffect(() => {
    void loadMetrics();
    void loadCounts();
  }, [loadMetrics, loadCounts]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadDayAgenda();
  }, [loadDayAgenda]);

  /** Recarrega tudo após qualquer mutação (criar/editar/cancelar). */
  const reloadAll = useCallback(() => {
    void loadMetrics();
    void loadCounts();
    void loadList();
    void loadDayAgenda();
  }, [loadMetrics, loadCounts, loadList, loadDayAgenda]);

  /* ------------------------ Interação com o calendário ---------------------- */
  const selectDay = (day: string): void => {
    setSelectedDay((cur) => (cur === day ? null : day));
    setFilters((prev) => {
      const next = { ...prev, from: day, to: day };
      return next;
    });
    setPage(1);
  };

  const clearFilters = (): void => {
    setFilters(EMPTY_FILTERS);
    setSelectedDay(null);
    setPage(1);
  };

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  /* ------------------------------- Deep link ------------------------------- */
  useEffect(() => {
    if (openMeetingId) {
      setDetailId(openMeetingId);
      setDetailOpen(true);
      onOpenMeetingConsumed();
    }
  }, [openMeetingId, onOpenMeetingConsumed]);

  /* --------------------------------- KPIs ---------------------------------- */
  const kpiCards = useMemo(() => {
    const next = (m: Meeting | null): string =>
      m ? `Próxima: ${formatClock(m.startsAt)} · ${m.title}` : 'Nenhuma reunião no período.';
    return [
      {
        kind: 'today' as const,
        label: 'Reuniões de hoje',
        value: metrics?.today ?? 0,
        hint: metrics ? next(metrics.todayNext) : '…',
        accent: 'from-brand-700 to-brand-500',
      },
      {
        kind: 'upcoming' as const,
        label: 'Próximas reuniões',
        value: metrics?.upcoming ?? 0,
        hint: metrics ? next(metrics.upcomingNext) : '…',
        accent: 'from-navy-800 to-navy-700',
      },
      {
        kind: 'month' as const,
        label: `Reuniões do mês (${monthName(Number(cursorMonth.slice(5, 7)) - 1).slice(0, 3)})`,
        value: metrics?.monthCount ?? 0,
        hint: `Total agendado no mês ${cursorMonth.slice(5, 7)}/${cursorMonth.slice(0, 4)}.`,
        accent: 'from-indigo-700 to-indigo-500',
      },
      {
        kind: 'mine' as const,
        label: 'Agendadas por mim',
        value: metrics?.createdByMe ?? 0,
        hint: 'Reuniões que você criou neste mês.',
        accent: 'from-emerald-700 to-emerald-500',
      },
    ];
  }, [metrics, cursorMonth]);

  const monthStart = `${cursorMonth}-01`;
  const [cmY, cmM] = cursorMonth.split('-').map(Number);
  const monthEnd = addDaysKey(
    `${cursorMonth}-${String(new Date(Date.UTC(cmY ?? 2026, cmM ?? 1, 0)).getUTCDate()).padStart(2, '0')}`,
    0,
  );

  const kpiQuery = useMemo(() => {
    switch (kpiOpen) {
      case 'today':
        return qs({ from: today, to: today, pageSize: 100 });
      case 'upcoming':
        return qs({ from: today, status: 'SCHEDULED', pageSize: 100 });
      case 'month':
        return qs({ from: monthStart, to: monthEnd, status: 'SCHEDULED', pageSize: 100 });
      case 'mine':
        return qs({ from: monthStart, to: monthEnd, createdByMe: 'true', status: 'SCHEDULED', pageSize: 100 });
      default:
        return '';
    }
  }, [kpiOpen, today, monthStart, monthEnd]);

  /* ------------------------------ Renderização ------------------------------ */
  const filtered = Boolean(filters.from || filters.to || filters.q || filters.createdByMe || filters.status !== 'ALL');

  return (
    <div className="space-y-6">
      {/* --------------------------- Cabeçalho --------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Agenda de Reuniões</h1>
          <p className="mt-1 text-sm text-slate-500">
            Agenda compartilhada da BA Elétrica — todos os usuários ativos veem as reuniões e recebem
            avisos por e-mail.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-brand-800"
        >
          <span aria-hidden="true">＋</span> Agendar reunião
        </button>
      </div>

      {/* ------------------------------- KPIs ------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => setKpiOpen(k.kind)}
            className="group overflow-hidden rounded-xl bg-white text-left shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className={`bg-gradient-to-r ${k.accent} px-4 py-3 text-white`}>
              <div className="text-xs font-medium opacity-90">{k.label}</div>
              <div className="mt-1 text-3xl font-bold leading-none">{k.value}</div>
            </div>
            <div className="px-4 py-3">
              <div className="truncate text-xs text-slate-500">{k.hint}</div>
              <div className="mt-1 text-[11px] font-semibold text-brand-700 opacity-0 transition group-hover:opacity-100">
                Clique para ver a lista →
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* --------------------- Calendário + agenda do dia --------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <MiniCalendar
          monthKey={cursorMonth}
          selected={selectedDay}
          counts={counts}
          onMonthChange={(m) => {
            setCursorMonth(m);
          }}
          onSelect={selectDay}
        />

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Agenda do dia">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-navy-900">
                {selectedDay ? `Agenda do dia ${formatDay(`${selectedDay}T12:00:00Z`)}` : 'Agenda do dia'}
              </h2>
              <p className="text-xs text-slate-400">
                {selectedDay ? 'Reuniões em ordem crescente de horário.' : 'Selecione um dia no calendário.'}
              </p>
            </div>
            {selectedDay && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDay(null);
                  clearFilters();
                }}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Voltar à agenda geral
              </button>
            )}
          </div>

          {!selectedDay && (
            <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-slate-400">
              <div className="mb-2 text-2xl" aria-hidden="true">
                🗓️
              </div>
              Escolha um dia para ver a agenda detalhada.
              <button
                type="button"
                onClick={() => selectDay(today)}
                className="mt-2 font-medium text-brand-700 hover:underline"
              >
                Ver hoje ({formatDay(`${today}T12:00:00Z`)})
              </button>
            </div>
          )}

          {selectedDay && dayLoading && <Spinner label="Carregando agenda do dia…" />}

          {selectedDay && !dayLoading && dayAgenda.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              Nenhuma reunião agendada para este dia.
            </p>
          )}

          {selectedDay && !dayLoading && dayAgenda.length > 0 && (
            <ul className="space-y-2">
              {dayAgenda.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailId(m.id);
                      setDetailOpen(true);
                    }}
                    className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition hover:border-brand-600 hover:bg-brand-50/50 ${
                      m.status === 'CANCELLED'
                        ? 'border-slate-200 bg-slate-50 opacity-70'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="w-24 shrink-0 text-xs font-semibold text-navy-900">
                      <div className="text-sm font-bold text-brand-800">
                        {formatClock(m.startsAt)}–{formatClock(m.endsAt)}
                      </div>
                      <div className="text-slate-400">{formatDuration(m.startsAt, m.endsAt)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm font-semibold ${m.status === 'CANCELLED' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {m.title}
                      </div>
                      <div className="truncate text-xs text-slate-500">Responsável: {m.responsibleName}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                        <Avatar name={m.createdByName} src={m.createdByAvatarUrl} size={18} />
                        <span className="truncate">Agendado por {m.createdByName}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {m.status === 'SCHEDULED' ? (
                        <Badge tone="green">Agendada</Badge>
                      ) : (
                        <Badge tone="red">Cancelada</Badge>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ------------------------------ Filtros ------------------------------ */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Filtros da lista">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">De</span>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
              value={filters.from}
              onChange={(e) => updateFilter('from', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Até</span>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
              value={filters.to}
              onChange={(e) => updateFilter('to', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Situação</span>
            <select
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value as Filters['status'])}
            >
              <option value="ALL">Todas</option>
              <option value="SCHEDULED">Agendadas</option>
              <option value="CANCELLED">Canceladas</option>
            </select>
          </label>
          <label className="flex items-center gap-2 py-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={filters.createdByMe}
              onChange={(e) => updateFilter('createdByMe', e.target.checked)}
            />
            Agendadas por mim
          </label>
          <label className="block min-w-52 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-500">Pesquisar</span>
            <input
              type="search"
              placeholder="Assunto, responsável ou agendador…"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
              value={filters.q}
              onChange={(e) => updateFilter('q', e.target.value)}
            />
          </label>
          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </section>

      {/* ------------------------------- Tabela ------------------------------- */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Lista de reuniões">
        {loading && <Spinner label="Carregando reuniões…" />}

        {!loading && listError && (
          <div className="m-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30" role="alert">
            {listError}
          </div>
        )}

        {!loading && !listError && items.length === 0 && (
          <div className="p-4">
            <EmptyState
              title={filtered ? 'Nenhuma reunião encontrada' : 'Ainda não há reuniões agendadas'}
              description={
                filtered
                  ? 'Ajuste os filtros ou limpe a busca para ver a agenda completa.'
                  : 'Assim que a primeira reunião for agendada, ela aparecerá aqui e todos os usuários ativos serão notificados.'
              }
              action={
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800"
                >
                  Agendar reunião
                </button>
              }
            />
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Horário</th>
                    <th className="px-4 py-3">Assunto</th>
                    <th className="px-4 py-3">Responsável</th>
                    <th className="px-4 py-3">Agendado por</th>
                    <th className="px-4 py-3">Situação</th>
                    <th className="px-4 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((m) => (
                    <tr key={m.id} className={`transition hover:bg-brand-50/40 ${m.status === 'CANCELLED' ? 'bg-slate-50/70 text-slate-400' : ''}`}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">{formatDay(m.startsAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-semibold text-navy-900">{formatClockRange(m.startsAt, m.endsAt)}</span>
                        <span className="ml-1 text-xs text-slate-400">({formatDuration(m.startsAt, m.endsAt)})</span>
                      </td>
                      <td className="max-w-56 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setDetailId(m.id);
                            setDetailOpen(true);
                          }}
                          className={`block truncate text-left font-semibold hover:text-brand-700 hover:underline ${m.status === 'CANCELLED' ? 'line-through' : 'text-slate-800'}`}
                        >
                          {m.title}
                        </button>
                      </td>
                      <td className="max-w-40 truncate px-4 py-3 text-slate-600">{m.responsibleName}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <Avatar name={m.createdByName} src={m.createdByAvatarUrl} size={26} />
                          <span className="max-w-36 truncate text-slate-600">{m.createdByName}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {m.status === 'SCHEDULED' ? <Badge tone="green">Agendada</Badge> : <Badge tone="red">Cancelada</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setDetailId(m.id);
                            setDetailOpen(true);
                          }}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-brand-600 hover:text-brand-700"
                        >
                          Abrir
                        </button>
                        {m.canManage && m.status === 'SCHEDULED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(m);
                              setFormOpen(true);
                            }}
                            className="ml-2 rounded-lg border border-brand-600/40 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* --------------------------- Paginação --------------------------- */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              <span>
                {total} reunião(ões) · página {page} de {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-white disabled:opacity-40"
                >
                  ← Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= Math.ceil(total / PAGE_SIZE)}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-white disabled:opacity-40"
                >
                  Próxima →
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* --------------------- Painel lateral de detalhe de KPI --------------------- */}
      <KpiPanel
        kind={kpiOpen}
        query={kpiQuery}
        onClose={() => setKpiOpen(null)}
        onOpen={(id) => {
          setKpiOpen(null);
          setDetailId(id);
          setDetailOpen(true);
        }}
        onClearFilters={() => {
          setKpiOpen(null);
          clearFilters();
        }}
      />

      {/* ------------------------------ Drawer de detalhe ------------------------------ */}
      <MeetingDetailDrawer
        meetingId={detailId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onEdit={(m) => {
          setDetailOpen(false);
          setEditing(m);
          setFormOpen(true);
        }}
        onChanged={() => {
          reloadAll();
          void loadMetrics();
        }}
      />

      {/* ------------------------------ Formulário ------------------------------ */}
      <MeetingFormDrawer
        open={formOpen}
        editing={editing}
        currentUser={currentUser}
        counts={counts}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => {
          toast.success(msg);
          setEditing(null);
          reloadAll();
        }}
      />
    </div>
  );
}

/* ------------------------- Painel lateral de KPI ------------------------- */

const KPI_META: Record<KpiKind, { title: string; subtitle: string }> = {
  today: { title: 'Reuniões de hoje', subtitle: 'Reuniões com início no dia corrente (fuso America/Manaus).' },
  upcoming: {
    title: 'Próximas reuniões',
    subtitle: 'Reuniões agendadas a partir de agora, em ordem crescente.',
  },
  month: { title: 'Reuniões do mês', subtitle: 'Reuniões agendadas no mês selecionado no calendário.' },
  mine: { title: 'Agendadas por mim', subtitle: 'Reuniões criadas por você no mês selecionado.' },
};

function KpiPanel({
  kind,
  query,
  onClose,
  onOpen,
  onClearFilters,
}: {
  kind: KpiKind | null;
  query: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onClearFilters: () => void;
}) {
  const [items, setItems] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    let active = true;
    setLoading(true);
    setError(null);
    api<Paginated<Meeting>>(`/api/v1/meetings${query}`)
      .then((r) => {
        if (active) setItems(r.items);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, query]);

  const meta = kind ? KPI_META[kind] : null;

  return (
    <Drawer
      open={kind !== null}
      onClose={onClose}
      title={meta?.title ?? ''}
      subtitle={meta?.subtitle}
      width="max-w-xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Limpar filtro / agenda geral
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800"
          >
            Fechar
          </button>
        </>
      }
    >
      {loading && <Spinner label="Carregando reuniões…" />}
      {!loading && error && (
        <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30">{error}</div>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Nenhuma reunião neste recorte.
        </p>
      )}
      {!loading && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onOpen(m.id)}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left transition hover:border-brand-600 hover:bg-brand-50/50"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-brand-800">
                    {formatDay(m.startsAt)} · {formatClockRange(m.startsAt, m.endsAt)}
                  </span>
                  {m.status === 'CANCELLED' ? <Badge tone="red">Cancelada</Badge> : <Badge tone="green">Agendada</Badge>}
                </div>
                <div className={`mt-1 truncate text-sm font-semibold ${m.status === 'CANCELLED' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {m.title}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">Responsável: {m.responsibleName}</div>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
                  <Avatar name={m.createdByName} src={m.createdByAvatarUrl} size={20} />
                  <span className="truncate">Agendado por {m.createdByName}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
