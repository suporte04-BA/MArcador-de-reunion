import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AvailabilityResponse, Department, Meeting, SessionUser } from '@agenda/shared';
import { api, ApiError, qs } from '../../lib/api';
import { Avatar, Drawer } from '../../components/ui';
import { inputClass } from '../auth/LoginPage';
import MiniCalendar from './MiniCalendar';
import { formatDay, monthKeyOf, todayKey, formatClock } from '../../lib/format';
import { useToast } from '../../lib/toast';

type FormState = {
  title: string;
  responsibleName: string;
  departmentId: string;
  date: string;
  start: string;
  end: string;
  description: string;
  observations: string;
};

const EMPTY: FormState = {
  title: '',
  responsibleName: '',
  departmentId: '',
  date: todayKey(),
  start: '09:00',
  end: '10:00',
  description: '',
  observations: '',
};

/**
 * Formulário amplo de agendamento/edição, em blocos:
 * Identificação · Quando (mini calendário + horários + disponibilidade) ·
 * Pauta · Complemento · Autoria (somente leitura).
 */
export default function MeetingFormDrawer({
  open,
  editing,
  currentUser,
  counts,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Meeting | null;
  currentUser: SessionUser;
  counts: Record<string, number>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avail, setAvail] = useState<AvailabilityResponse | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);
  const [cursorMonth, setCursorMonth] = useState<string>(() => monthKeyOf(new Date()));
  const availSeq = useRef(0);

  // Preenche ao editar / reseta ao abrir para criação.
  useEffect(() => {
    if (!open) return;
    void api<{ items: Department[] }>('/api/v1/departments').then((r) => setDepartments(r.items)).catch(() => setDepartments([]));
    setErrors({});
    setServerError(null);
    setAvail(null);
    setAvailError(null);
    if (editing) {
      const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Manaus',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(editing.startsAt));
      const t = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Manaus',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(editing.startsAt));
      const te = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Manaus',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(editing.endsAt));
      setForm({
        title: editing.title,
        responsibleName: editing.responsibleName,
        departmentId: editing.departmentId ?? '',
        date: p,
        start: t,
        end: te,
        description: editing.description,
        observations: editing.observations ?? '',
      });
      setCursorMonth(p.slice(0, 7));
    } else {
      setForm({ ...EMPTY, departmentId: currentUser.departmentId ?? '' });
      setCursorMonth(monthKeyOf(new Date()));
    }
  }, [open, editing, currentUser.departmentId]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /* ----------------------- Consulta de disponibilidade ----------------------- */
  const checkAvailability = useCallback(async () => {
    const { date, start, end } = form;
    if (!date || !start || !end || end <= start) {
      setAvail(null);
      return;
    }
    const seq = ++availSeq.current;
    setAvailLoading(true);
    setAvailError(null);
    try {
      const r = await api<AvailabilityResponse>(
        `/api/v1/meetings/availability${qs({ date, start, end, excludeId: editing?.id })}`,
      );
      if (seq === availSeq.current) setAvail(r);
    } catch (err) {
      // Sem falsa disponibilidade: se a consulta falhar, dizemos que não sabemos.
      if (seq === availSeq.current) {
        setAvail(null);
        setAvailError(err instanceof ApiError ? err.message : 'Não foi possível verificar a agenda.');
      }
    } finally {
      if (seq === availSeq.current) setAvailLoading(false);
    }
  }, [form.date, form.start, form.end, editing?.id]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void checkAvailability(), 350);
    return () => window.clearTimeout(timer);
  }, [open, checkAvailability]);

  /* --------------------------------- Salvar -------------------------------- */
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setServerError(null);

    const local: Record<string, string> = {};
    if (form.title.trim().length < 3) local.title = 'Informe um assunto com pelo menos 3 caracteres.';
    if (form.responsibleName.trim().length < 2) local.responsibleName = 'Informe o responsável.';
    if (!form.departmentId) local.departmentId = 'Setor da reunião é obrigatório.';
    if (!form.date) local.date = 'Escolha a data.';
    if (!form.start) local.start = 'Informe a hora de início.';
    if (!form.end) local.end = 'Informe a hora de término.';
    if (form.start && form.end && form.end <= form.start)
      local.end = 'A hora de término deve ser posterior à hora de início.';
    if (form.description.trim().length < 5) local.description = 'Descreva a finalidade da reunião.';
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        responsibleName: form.responsibleName.trim(),
        departmentId: form.departmentId,
        date: form.date,
        start: form.start,
        end: form.end,
        description: form.description.trim(),
        observations: form.observations.trim(),
      };
      if (editing) {
        await api(`/api/v1/meetings/${editing.id}`, { method: 'PATCH', body: payload });
        onSaved('Reunião atualizada. Todos os usuários ativos serão notificados por e-mail.');
      } else {
        await api('/api/v1/meetings', { method: 'POST', body: payload });
        onSaved('Reunião agendada. Todos os usuários ativos receberão aviso por e-mail.');
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(err.details)) mapped[k] = v[0] ?? '';
          setErrors(mapped);
        }
        if (err.status !== 409) toast.push(err.message, 'error');
      } else {
        setServerError('Erro inesperado ao salvar. Tente novamente.');
      }
    } finally {
      setBusy(false);
    }
  };

  const isPastDay = form.date && form.date < todayKey();

  const availBadge = useMemo(() => {
    if (availError) return { tone: 'slate' as const, text: `Verificação indisponível: ${availError}` };
    if (availLoading) return { tone: 'slate' as const, text: 'Verificando disponibilidade…' };
    if (!avail) return null;
    if (avail.available) return { tone: 'green' as const, text: 'Livre — este horário está disponível.' };
    return {
      tone: 'red' as const,
      text: `Conflita com reunião existente — ${avail.conflicts.length} reunião(ões) neste período.`,
    };
  }, [avail, availLoading, availError]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? 'Editar reunião' : 'Agendar reunião'}
      subtitle={
        editing
          ? 'Alterações notificam todos os usuários ativos por e-mail.'
          : 'A agenda é compartilhada: todos os usuários ativos serão notificados.'
      }
      width="max-w-3xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="meeting-form"
            disabled={busy}
            className="rounded-lg bg-brand-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-60"
          >
            {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Agendar reunião'}
          </button>
        </>
      }
    >
      <form id="meeting-form" onSubmit={submit} className="space-y-6">
        {serverError && (
          <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30" role="alert">
            <strong>Não foi possível salvar:</strong> {serverError}
            {avail?.conflicts.length ? (
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                {avail.conflicts.map((c) => (
                  <li key={c.id}>
                    {c.title} — {formatClock(c.startsAt)}–{formatClock(c.endsAt)} ({c.responsibleName})
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {/* ---------------------------- Identificação ---------------------------- */}
        <fieldset className="space-y-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            1 · Identificação
          </legend>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Assunto *</span>
            <input
              className={inputClass(!!errors.title)}
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              maxLength={200}
              placeholder="Ex.: Reunião de alinhamento semanal"
              autoFocus={!editing}
            />
            {errors.title && <span className="mt-1 block text-xs text-danger-600">{errors.title}</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Responsável pela reunião *</span>
            <input
              className={inputClass(!!errors.responsibleName)}
              value={form.responsibleName}
              onChange={(e) => setField('responsibleName', e.target.value)}
              maxLength={120}
              placeholder="Nome de quem conduz a reunião (texto livre)"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Campo de texto — não confira permissões de edição.
            </span>
            {errors.responsibleName && (
              <span className="mt-1 block text-xs text-danger-600">{errors.responsibleName}</span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Setor da reunião *</span>
            <select
              className={inputClass(!!errors.departmentId)}
              value={form.departmentId}
              onChange={(e) => setField('departmentId', e.target.value)}
            >
              <option value="">Selecione…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.isActive}>
                  {d.name}
                </option>
              ))}
            </select>
            {errors.departmentId && (
              <span className="mt-1 block text-xs text-danger-600">{errors.departmentId}</span>
            )}
          </label>
        </fieldset>

        {/* --------------------------------- Quando -------------------------------- */}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">2 · Quando</legend>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <MiniCalendar
                monthKey={cursorMonth}
                selected={form.date}
                counts={counts}
                onMonthChange={setCursorMonth}
                onSelect={(d) => setField('date', d)}
              />
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>Data: <strong>{formatDay(`${form.date}T12:00:00Z`)}</strong></span>
                <button
                  type="button"
                  onClick={() => setField('date', todayKey())}
                  className="font-medium text-brand-700 hover:underline"
                >
                  Ir para hoje
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Hora de início *</span>
                  <input
                    type="time"
                    step={300}
                    className={inputClass(!!errors.start)}
                    value={form.start}
                    onChange={(e) => setField('start', e.target.value)}
                  />
                  {errors.start && <span className="mt-1 block text-xs text-danger-600">{errors.start}</span>}
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Hora de término *</span>
                  <input
                    type="time"
                    step={300}
                    className={inputClass(!!errors.end)}
                    value={form.end}
                    onChange={(e) => setField('end', e.target.value)}
                  />
                  {errors.end && <span className="mt-1 block text-xs text-danger-600">{errors.end}</span>}
                </label>
              </div>

              {availBadge && (
                <div
                  className={[
                    'rounded-lg px-3 py-2 text-xs font-medium ring-1',
                    availBadge.tone === 'green'
                      ? 'bg-success-50 text-success-600 ring-success-600/30'
                      : availBadge.tone === 'red'
                        ? 'bg-danger-50 text-danger-700 ring-danger-600/30'
                        : 'bg-slate-100 text-slate-600 ring-slate-300/50',
                  ].join(' ')}
                  role="status"
                >
                  {availBadge.text}
                  {avail && !avail.available && avail.conflicts.length > 0 && (
                    <ul className="mt-1.5 list-inside list-disc space-y-0.5 font-normal text-slate-600">
                      {avail.conflicts.map((c) => (
                        <li key={c.id}>
                          {c.title} ({formatClock(c.startsAt)}–{formatClock(c.endsAt)})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {isPastDay && !editing && (
                <div className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-600 ring-1 ring-warning-600/30">
                  A data escolhida é anterior a hoje — o servidor não permitirá o agendamento.
                </div>
              )}
            </div>
          </div>
        </fieldset>

        {/* --------------------------------- Pauta --------------------------------- */}
        <fieldset className="space-y-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">3 · Pauta</legend>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Descrição *</span>
            <textarea
              className={inputClass(!!errors.description)}
              rows={4}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              maxLength={4000}
              placeholder="Finalidade/pauta da reunião"
            />
            {errors.description && (
              <span className="mt-1 block text-xs text-danger-600">{errors.description}</span>
            )}
          </label>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            4 · Complemento (opcional)
          </legend>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Observações</span>
            <textarea
              className={inputClass(false)}
              rows={3}
              value={form.observations}
              onChange={(e) => setField('observations', e.target.value)}
              maxLength={4000}
              placeholder="Informações complementares, sala, link, materiais…"
            />
          </label>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            5 · Autoria (somente leitura)
          </legend>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <Avatar name={currentUser.fullName} src={currentUser.avatarUrl} size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">{currentUser.fullName}</div>
              <div className="truncate text-xs text-slate-500">
                Agendado por @{currentUser.username} — preenchido automaticamente pela sessão.
              </div>
            </div>
          </div>
        </fieldset>
      </form>
    </Drawer>
  );
}
