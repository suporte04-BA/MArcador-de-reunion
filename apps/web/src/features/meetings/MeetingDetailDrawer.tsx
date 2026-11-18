import { useCallback, useEffect, useState } from 'react';
import type { Meeting } from '@agenda/shared';
import { api, ApiError } from '../../lib/api';
import { Avatar, Badge, ConfirmDialog, Drawer, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';
import {
  formatClock,
  formatDay,
  formatDuration,
  formatFullDay,
  monthName,
} from '../../lib/format';

/**
 * Detalhe completo da reunião.
 * Ações de edição/cancelamento são exibidas somente para autor ou ADMIN —
 * e a API revalida a permissão independentemente da interface.
 */
export default function MeetingDetailDrawer({
  meetingId,
  open,
  onClose,
  onEdit,
  onChanged,
}: {
  meetingId: string | null;
  open: boolean;
  onClose: () => void;
  onEdit: (meeting: Meeting) => void;
  onChanged: (message: string) => void;
}) {
  const toast = useToast();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!meetingId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ meeting: Meeting }>(`/api/v1/meetings/${meetingId}`);
      setMeeting(r.meeting);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar a reunião.');
      setMeeting(null);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (open && meetingId) void load();
    if (!open) {
      setMeeting(null);
      setError(null);
    }
  }, [open, meetingId, load]);

  const cancelMeeting = async (): Promise<void> => {
    if (!meeting) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/api/v1/meetings/${meeting.id}`, { method: 'DELETE' });
      toast.success(r.message ?? 'Reunião cancelada.');
      setConfirmOpen(false);
      onChanged('Reunião cancelada.');
      onClose();
      await load().catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível cancelar a reunião.');
    } finally {
      setBusy(false);
    }
  };

  const start = meeting ? new Date(meeting.startsAt) : null;
  const monthLabel = start ? monthName(start.getUTCMonth()) : '';

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={meeting ? meeting.title : 'Detalhe da reunião'}
        subtitle={meeting ? `${formatFullDay(meeting.startsAt)} · ${formatClock(meeting.startsAt)}–${formatClock(meeting.endsAt)}` : undefined}
        width="max-w-2xl"
        footer={
          meeting ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Fechar
              </button>
              {meeting.canManage && meeting.status === 'SCHEDULED' && (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    className="rounded-lg border border-danger-600 px-4 py-2 text-sm font-semibold text-danger-600 transition hover:bg-danger-50"
                  >
                    Cancelar reunião
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(meeting)}
                    className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800"
                  >
                    Editar
                  </button>
                </>
              )}
            </>
          ) : null
        }
      >
        {loading && <Spinner label="Carregando reunião…" />}
        {!loading && error && (
          <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30" role="alert">
            {error}
          </div>
        )}

        {!loading && !error && meeting && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {meeting.status === 'SCHEDULED' ? (
                <Badge tone="green">Agendada</Badge>
              ) : (
                <Badge tone="red">Cancelada</Badge>
              )}
              {!meeting.canManage && <Badge tone="slate">Somente leitura</Badge>}
              {meeting.canManage && <Badge tone="blue">Você pode editar</Badge>}
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Info label="Data completa" value={formatFullDay(meeting.startsAt)} />
              <Info
                label="Horário"
                value={`${formatClock(meeting.startsAt)} – ${formatClock(meeting.endsAt)} (${formatDuration(meeting.startsAt, meeting.endsAt)})`}
              />
              <Info label="Responsável" value={meeting.responsibleName} />
              <Info label="Setor" value={meeting.departmentName ?? '—'} />
              <Info label="Situação" value={meeting.status === 'SCHEDULED' ? 'Agendada' : 'Cancelada'} />
            </dl>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Descrição</h3>
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100">
                {meeting.description}
              </p>
            </section>

            {meeting.observations ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Observações</h3>
                <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100">
                  {meeting.observations}
                </p>
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-200 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Autoria</h3>
              <div className="flex items-center gap-3">
                <Avatar name={meeting.createdByName} src={meeting.createdByAvatarUrl} size={40} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{meeting.createdByName}</div>
                  <div className="truncate text-xs text-slate-500">
                    Agendado por @{meeting.createdByUsername} · {formatDay(meeting.createdAt)} às{' '}
                    {formatClock(meeting.createdAt)}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <div>
                  Criada em {formatDay(meeting.createdAt)} às {formatClock(meeting.createdAt)}
                  {monthLabel ? '' : ''}
                </div>
                <div>
                  Última atualização em {formatDay(meeting.updatedAt)} às {formatClock(meeting.updatedAt)}
                  {meeting.updatedByName ? ` por ${meeting.updatedByName}` : ''}
                </div>
                {meeting.status === 'CANCELLED' && meeting.cancelledAt && (
                  <div className="text-danger-600">
                    Cancelada em {formatDay(meeting.cancelledAt)} às {formatClock(meeting.cancelledAt)}
                    {meeting.cancelledByName ? ` por ${meeting.cancelledByName}` : ''}
                  </div>
                )}
              </div>
            </section>

            {meeting.status === 'SCHEDULED' && !meeting.canManage && (
              <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500 ring-1 ring-slate-100">
                Somente <strong>{meeting.createdByName}</strong> (autor) ou um administrador pode alterar ou
                cancelar esta reunião.
              </p>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        title="Cancelar reunião?"
        danger
        busy={busy}
        confirmLabel="Sim, cancelar"
        message={
          <>
            A reunião <strong>“{meeting?.title}”</strong> será marcada como cancelada, o horário voltará a
            ficar disponível na agenda e <strong>todos os usuários ativos</strong> receberão aviso por
            e-mail. O registro histórico é mantido.
          </>
        }
        onConfirm={() => void cancelMeeting()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}
