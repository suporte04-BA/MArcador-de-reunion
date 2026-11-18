import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Paginated, PublicUser, SessionUser, Department, AdminStats } from '@agenda/shared';
import { DEPARTMENT_COLORS, PASSWORD_MIN_LENGTH } from '@agenda/shared';
import { api, ApiError, qs } from '../../lib/api';
import { Avatar, Badge, ConfirmDialog, Drawer, EmptyState, Spinner } from '../../components/ui';
import { inputClass } from '../auth/LoginPage';
import { useToast } from '../../lib/toast';
import { formatAbsolute, formatDay } from '../../lib/format';

type Action =
  | { kind: 'edit'; user: PublicUser }
  | { kind: 'test-email'; user: PublicUser }
  | { kind: 'reset-password'; user: PublicUser }
  | { kind: 'deactivate'; user: PublicUser }
  | { kind: 'delete'; user: PublicUser }
  | null;

/**
 * Aba Usuários — exclusiva de administradores.
 * A API revalida o perfil em cada endpoint (a interface apenas espelha a permissão).
 */
export default function UsersTab({ currentUser }: { currentUser: SessionUser }) {
  const toast = useToast();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [subTab, setSubTab] = useState<'users' | 'departments'>('users');
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [avatarTarget, setAvatarTarget] = useState<PublicUser | null>(null);
  const [avatarUrlInput, setAvatarUrlInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, d, s] = await Promise.all([
        api<{ items: PublicUser[] }>('/api/v1/admin/users'),
        api<{ items: Department[] }>('/api/v1/admin/departments'),
        api<AdminStats>('/api/v1/admin/stats'),
      ]);
      setUsers(u.items);
      setDepartments(d.items);
      setStats(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar usuários.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* --------------------------------- KPIs --------------------------------- */
  const kpis = useMemo(() => {
    return [
      {
        kind: 'users' as const,
        label: 'Total de usuários',
        value: stats?.users.total ?? users.length,
        sub: `${stats?.users.active ?? 0} ativos`,
        accent: 'from-navy-800 to-navy-700',
        onClick: () => setSubTab('users'),
      },
      {
        kind: 'departments' as const,
        label: 'Total de setores',
        value: stats?.departments.total ?? departments.length,
        sub: `${stats?.departments.active ?? 0} ativos`,
        accent: 'from-brand-700 to-brand-600',
        onClick: () => setSubTab('departments'),
      },
    ];
  }, [stats, users.length, departments.length]);

  const isValidEmail = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = `${u.fullName} ${u.username} ${u.email}`.toLowerCase();
      return hay.includes(q);
    });
  }, [users, search]);

  /* ------------------------------- Ações da linha ------------------------------- */
  const runAction = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      const msg = await fn();
      toast.success(msg);
      setAction(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Ação não concluída.');
    } finally {
      setBusy(false);
    }
  };

  const onAvatarFile = async (file: File): Promise<void> => {
    if (!avatarTarget) return;
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${avatarTarget.id}/avatar`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new ApiError(res.status, 'AVATAR', data?.error ?? 'Falha ao enviar a imagem.');
      toast.success('Foto/avatar atualizado.');
      setAvatarTarget(null);
      setAvatarUrlInput('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao enviar a imagem.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onAvatarUrl = async (): Promise<void> => {
    if (!avatarTarget) return;
    setBusy(true);
    try {
      await api<{ ok: boolean; avatarUrl: string }>(`/api/v1/admin/users/${avatarTarget.id}/avatar-url`, {
        method: 'POST',
        body: { url: avatarUrlInput.trim() },
      });
      toast.success('Foto/avatar atualizado pelo link.');
      setAvatarTarget(null);
      setAvatarUrlInput('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao aplicar o link.');
    } finally {
      setBusy(false);
    }
  };

  const isAdminView = currentUser.role === 'ADMIN';
  if (!isAdminView) {
    return <EmptyState title="Acesso restrito" description="Esta área é exclusiva de administradores." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Usuários</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastro, setores e administração de acessos à Agenda BA.
          </p>
        </div>
        {subTab === 'users' && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-brand-800"
          >
            ＋ Cadastrar usuário
          </button>
        )}
      </div>

      {/* --------------------------------- KPIs --------------------------------- */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {kpis.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={k.onClick}
            className="overflow-hidden rounded-xl bg-white text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
          >
            <div className={`bg-gradient-to-r ${k.accent} px-4 py-3 text-white`}>
              <div className="text-xs font-medium opacity-90">{k.label}</div>
              <div className="mt-1 text-3xl font-bold leading-none">{k.value}</div>
              <div className="mt-1 text-[11px] opacity-80">{k.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* ------------------------------ Sub-abas ------------------------------ */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setSubTab('users')}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
            subTab === 'users' ? 'bg-white text-navy-900 shadow' : 'text-slate-600 hover:text-navy-900'
          }`}
        >
          Usuários
        </button>
        <button
          type="button"
          onClick={() => setSubTab('departments')}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
            subTab === 'departments' ? 'bg-white text-navy-900 shadow' : 'text-slate-600 hover:text-navy-900'
          }`}
        >
          Setores
        </button>
      </div>
      {subTab === 'users' && (
        <>
        <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Pesquisar por nome, usuário ou e-mail…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <span className="text-sm text-slate-400">
          {visible.length} de {users.length} usuário(s)
        </span>
      </div>

      {/* --------------------------------- Tabela --------------------------------- */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading && <Spinner label="Carregando usuários…" />}
        {!loading && error && (
          <div className="m-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30">{error}</div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="Nenhum usuário encontrado"
              description="Ajuste a pesquisa ou o filtro, ou cadastre um novo usuário."
              action={
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
                >
                  Cadastrar usuário
                </button>
              }
            />
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Nome de usuário</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Setor</th>
                  <th className="px-4 py-3">Perfil</th>
                  <th className="px-4 py-3">Último acesso</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((u) => (
                  <tr key={u.id} className="transition hover:bg-brand-50/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          title="Atualizar foto/avatar"
                          onClick={() => {
                            setAvatarTarget(u);
                            setAvatarUrlInput('');
                          }}
                          className="rounded-full transition hover:ring-2 hover:ring-brand-600"
                        >
                          <Avatar name={u.fullName} src={u.avatarUrl} size={32} />
                        </button>
                        <span className="font-semibold text-slate-800">{u.fullName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">@{u.username}</td>
                    <td className={`px-4 py-3 ${isValidEmail(u.email) ? 'text-slate-600' : 'font-medium text-danger-600'}`}>
                      {u.email}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.departmentName ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3">
                      {u.role === 'ADMIN' ? <Badge tone="blue">Administrador</Badge> : <Badge tone="slate">Usuário</Badge>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {u.lastLoginAt ? formatAbsolute(u.lastLoginAt) : <span className="text-slate-400">Nunca acessou</span>}
                      <div className="text-[11px] text-slate-400">Cadastrado em {formatDay(u.createdAt)}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <RowBtn onClick={() => setAction({ kind: 'edit', user: u })}>Editar</RowBtn>
                        <RowBtn onClick={() => setAction({ kind: 'test-email', user: u })}>E-mail de teste</RowBtn>
                        <RowBtn onClick={() => setAction({ kind: 'reset-password', user: u })}>Redefinir senha</RowBtn>
                        <RowBtn danger onClick={() => setAction({ kind: 'delete', user: u })}>Excluir</RowBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </>
      )}

      {subTab === 'departments' && (
        <DepartmentsPanel
          departments={departments}
          toast={toast}
          onChanged={load}
        />
      )}
      <CreateUserDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(msg) => {
          toast.success(msg);
          setCreateOpen(false);
          void load();
        }}
      />

      {/* --------------------------- Drawer de edição --------------------------- */}
      <EditUserDrawer
        user={action?.kind === 'edit' ? action.user : null}
        onClose={() => setAction(null)}
        onSaved={(msg) => {
          toast.success(msg);
          setAction(null);
          void load();
        }}
      />

      {/* ------------------------- Confirmações de ação ------------------------- */}
      <ConfirmDialog
        open={action?.kind === 'test-email'}
        title="Enviar e-mail de teste"
        busy={busy}
        confirmLabel="Enviar teste"
        message={
          <>
            A mensagem <strong>“Teste de e-mail — Agenda BA”</strong> será enviada{' '}
            <strong>somente para {action?.kind === 'test-email' ? action.user.email : ''}</strong>. Nenhum
            outro usuário recebe esta mensagem.
          </>
        }
        onConfirm={() => {
          if (action?.kind !== 'test-email') return;
          const u = action.user;
          void runAction(async () => {
            const r = await api<{ message: string }>(`/api/v1/admin/users/${u.id}/send-test-email`, {
              method: 'POST',
              body: { confirm: true },
            });
            return r.message;
          });
        }}
        onCancel={() => setAction(null)}
      />

      <ConfirmDialog
        open={action?.kind === 'reset-password'}
        title="Solicitar redefinição de senha"
        busy={busy}
        confirmLabel="Enviar link"
        message={
          <>
            Um link de uso único (validade de 60 minutos) será enfileirado para{' '}
            <strong>{action?.kind === 'reset-password' ? action.user.email : ''}</strong>. O usuário define
            a própria senha — nenhuma senha é enviada por e-mail.
          </>
        }
        onConfirm={() => {
          if (action?.kind !== 'reset-password') return;
          const u = action.user;
          void runAction(async () => {
            const r = await api<{ message: string }>(`/api/v1/admin/users/${u.id}/request-password-reset`, {
              method: 'POST',
            });
            return r.message;
          });
        }}
        onCancel={() => setAction(null)}
      />

      <ConfirmDialog
        open={action?.kind === 'delete'}
        title="Excluir usuário?"
        danger
        busy={busy}
        confirmLabel="Sim, excluir"
        message={
          <>
            <strong>{action?.kind === 'delete' ? action.user.fullName : ''}</strong> será excluído
            permanentemente, junto com suas reuniões e notificações. O sistema precisa manter ao menos
            2 administradores ativos. Esta ação não pode ser desfeita.
          </>
        }
        onConfirm={() => {
          if (action?.kind !== 'delete') return;
          const u = action.user;
          void runAction(async () => {
            const r = await api<{ message: string }>(`/api/v1/admin/users/${u.id}`, { method: 'DELETE' });
            return r.message;
          });
        }}
        onCancel={() => setAction(null)}
      />

      {/* --------------------------- Avatar (upload ou link) --------------------------- */}
      <Drawer
        open={avatarTarget !== null}
        onClose={() => {
          setAvatarTarget(null);
          setAvatarUrlInput('');
        }}
        title="Atualizar foto/avatar"
        subtitle={avatarTarget ? avatarTarget.fullName : undefined}
        width="max-w-md"
      >
        {avatarTarget && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name={avatarTarget.fullName} src={avatarTarget.avatarUrl} size={56} />
              <p className="text-xs text-slate-500">
                Formatos aceitos no upload: PNG, JPEG ou WebP, até 2 MB.
              </p>
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                1 · Enviar arquivo do computador
              </h3>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-800"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onAvatarFile(f);
                }}
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                2 · Colar link de uma imagem
              </h3>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={avatarUrlInput}
                  onChange={(e) => setAvatarUrlInput(e.target.value)}
                  placeholder="https://exemplo.com/foto.png"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={busy || !avatarUrlInput.trim()}
                  onClick={() => void onAvatarUrl()}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-60"
                >
                  {busy ? 'Aplicando…' : 'Aplicar link'}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                A imagem será referenciada pelo link informado (não é copiada para o servidor).
              </p>
            </section>
          </div>
        )}
      </Drawer>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" />
    </div>
  );
}

function RowBtn({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
        danger
          ? 'border-danger-600/40 text-danger-600 hover:bg-danger-50'
          : 'border-slate-300 text-slate-600 hover:border-brand-600 hover:text-brand-700'
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------- Cadastro de usuário ------------------------- */

function CreateUserDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [form, setForm] = useState({
    fullName: '',
    username: '',
    email: '',
    departmentId: '',
    temporaryPassword: '',
    confirmPassword: '',
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ fullName: '', username: '', email: '', departmentId: '', temporaryPassword: '', confirmPassword: '' });
      setErrors({});
      setServerError(null);
      void api<{ items: Department[] }>('/api/v1/departments').then((r) => setDepartments(r.items)).catch(() => setDepartments([]));
    }
  }, [open]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setServerError(null);
    const local: Record<string, string> = {};
    if (form.fullName.trim().length < 2) local.fullName = 'Informe o nome completo.';
    if (form.username.trim().length < 3) local.username = 'Mínimo de 3 caracteres.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) local.email = 'E-mail inválido.';
    if (!form.departmentId) local.departmentId = 'Setor é obrigatório.';
    if (form.temporaryPassword.length < PASSWORD_MIN_LENGTH)
      local.temporaryPassword = `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`;
    if (form.temporaryPassword !== form.confirmPassword) local.confirmPassword = 'As senhas não coincidem.';
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setBusy(true);
    try {
      const r = await api<{ message: string }>('/api/v1/admin/users', {
        method: 'POST',
        body: {
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          email: form.email.trim(),
          departmentId: form.departmentId,
          temporaryPassword: form.temporaryPassword,
        },
      });
      onCreated(r.message);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(err.details)) mapped[k] = (v as string[])[0] ?? '';
          setErrors(mapped);
        }
      } else {
        setServerError('Erro inesperado ao cadastrar.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Cadastrar usuário"
      subtitle="A conta é criada ativa: o usuário entra com a senha inicial definida."
      width="max-w-xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" form="create-user-form" disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
            {busy ? 'Salvando…' : 'Cadastrar'}
          </button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={submit} className="space-y-4">
        {serverError && (
          <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30">{serverError}</div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Nome completo *</span>
          <input className={inputClass(!!errors.fullName)} value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} maxLength={120} />
          {errors.fullName && <span className="mt-1 block text-xs text-danger-600">{errors.fullName}</span>}
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Nome de usuário *</span>
            <input className={inputClass(!!errors.username)} value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="ex.: maria.souza" maxLength={60} />
            <span className="mt-1 block text-xs text-slate-400">Minúsculas, números, espaços, ponto, hífen ou sublinhado.</span>
            {errors.username && <span className="mt-1 block text-xs text-danger-600">{errors.username}</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">E-mail *</span>
            <input type="email" className={inputClass(!!errors.email)} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} maxLength={254} />
            {errors.email && <span className="mt-1 block text-xs text-danger-600">{errors.email}</span>}
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Setor *</span>
            <select
              className={inputClass(!!errors.departmentId)}
              value={form.departmentId}
              onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
            >
              <option value="">Selecione…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.isActive}>
                  {d.name}
                </option>
              ))}
            </select>
            {errors.departmentId && <span className="mt-1 block text-xs text-danger-600">{errors.departmentId}</span>}
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Senha inicial *</span>
            <input
              type="password"
              className={inputClass(!!errors.temporaryPassword)}
              value={form.temporaryPassword}
              onChange={(e) => setForm((f) => ({ ...f, temporaryPassword: e.target.value }))}
              autoComplete="new-password"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Mínimo de {PASSWORD_MIN_LENGTH} caracteres. A conta nasce ativa e o usuário já pode entrar
              imediatamente. A senha não é exibida depois de salva.
            </span>
            {errors.temporaryPassword && <span className="mt-1 block text-xs text-danger-600">{errors.temporaryPassword}</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Confirmar senha *</span>
            <input
              type="password"
              className={inputClass(!!errors.confirmPassword)}
              value={form.confirmPassword}
              onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              autoComplete="new-password"
            />
            {errors.confirmPassword && <span className="mt-1 block text-xs text-danger-600">{errors.confirmPassword}</span>}
          </label>
        </div>
      </form>
    </Drawer>
  );
}

/* --------------------------- Edição de usuário --------------------------- */

function EditUserDrawer({
  user,
  onClose,
  onSaved,
}: {
  user: PublicUser | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({ fullName: '', username: '', email: '', departmentId: '', password: '' });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({ fullName: user.fullName, username: user.username, email: user.email, departmentId: user.departmentId ?? '', password: '' });
      setErrors({});
      setServerError(null);
      void api<{ items: Department[] }>('/api/v1/departments?all=true').then((r) => setDepartments(r.items)).catch(() => setDepartments([]));
    }
  }, [user]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!user) return;
    setServerError(null);
    const local: Record<string, string> = {};
    if (form.fullName.trim().length < 2) local.fullName = 'Informe o nome completo.';
    if (form.username.trim().length < 3) local.username = 'Mínimo de 3 caracteres.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) local.email = 'E-mail inválido.';
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/api/v1/admin/users/${user.id}`, {
        method: 'PATCH',
        body: {
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          email: form.email.trim(),
          departmentId: form.departmentId || undefined,
          ...(form.password.trim() ? { password: form.password } : {}),
        },
      });
      onSaved(r.message);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(err.details)) mapped[k] = v[0] ?? '';
          setErrors(mapped);
        }
      } else {
        setServerError('Erro inesperado ao salvar.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={user !== null}
      onClose={onClose}
      title="Editar usuário"
      subtitle={user ? `@${user.username} · ${user.email}` : undefined}
      width="max-w-xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" form="edit-user-form" disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={submit} className="space-y-4">
        {serverError && (
          <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30">{serverError}</div>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Nome completo *</span>
          <input className={inputClass(!!errors.fullName)} value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} maxLength={120} />
          {errors.fullName && <span className="mt-1 block text-xs text-danger-600">{errors.fullName}</span>}
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Nome de usuário *</span>
            <input className={inputClass(!!errors.username)} value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} maxLength={60} />
            {errors.username && <span className="mt-1 block text-xs text-danger-600">{errors.username}</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">E-mail *</span>
            <input type="email" className={inputClass(!!errors.email)} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} maxLength={254} />
            {errors.email && <span className="mt-1 block text-xs text-danger-600">{errors.email}</span>}
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Setor</span>
          <select
            className={inputClass(!!errors.departmentId)}
            value={form.departmentId}
            onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
          >
            <option value="">— manter —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id} disabled={!d.isActive}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Nova senha (opcional)</span>
          <input
            type="password"
            className={inputClass(false)}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            autoComplete="new-password"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Deixe em branco para manter a senha atual. Ao definir, o usuário poderá entrar com esta senha.
          </span>
        </label>
      </form>
    </Drawer>
  );
}

/* --------------------------- Painel de setores (subaba) --------------------------- */

function DepartmentsPanel({
  departments,
  toast,
  onChanged,
}: {
  departments: Department[];
  toast: ReturnType<typeof useToast>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Department | null>(null);
  const [creating, setCreating] = useState(false);

  const toggleActive = async (d: Department): Promise<void> => {
    try {
      const url = d.isActive
        ? `/api/v1/admin/departments/${d.id}/deactivate`
        : `/api/v1/admin/departments/${d.id}/activate`;
      const r = await api<{ message: string }>(url, { method: 'POST' });
      toast.success(r.message);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Ação não concluída.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-navy-900">Setores</h2>
          <p className="mt-1 text-sm text-slate-500">
            Setores organizacionais: independentes de perfil (ADMIN/USER). Desativar mantém o histórico.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-brand-800"
        >
          ＋ Novo setor
        </button>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Setor</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Usuários ativos</th>
                <th className="px-4 py-3">Reuniões</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departments.map((d) => (
                <tr key={d.id} className="transition hover:bg-brand-50/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: colorOf(d.colorKey) }}
                      />
                      <span className="font-semibold text-slate-800">{d.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{d.description || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{d.activeUserCount}</td>
                  <td className="px-4 py-3 text-slate-600">{d.meetingCount}</td>
                  <td className="px-4 py-3">
                    {d.isActive ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap justify-end gap-1.5">
                      <RowBtn onClick={() => setEditing(d)}>Editar</RowBtn>
                      <RowBtn onClick={() => void toggleActive(d)}>{d.isActive ? 'Desativar' : 'Reativar'}</RowBtn>
                    </div>
                  </td>
                </tr>
              ))}
              {departments.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                    Nenhum setor cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <DepartmentFormDrawer
        open={creating}
        initial={null}
        onClose={() => setCreating(false)}
        onSaved={async (msg) => {
          toast.success(msg);
          setCreating(false);
          await onChanged();
        }}
      />
      <DepartmentFormDrawer
        open={editing !== null}
        initial={editing}
        onClose={() => setEditing(null)}
        onSaved={async (msg) => {
          toast.success(msg);
          setEditing(null);
          await onChanged();
        }}
      />
    </div>
  );
}

function colorOf(key: Department['colorKey']): string {
  const map: Record<string, string> = {
    azul: '#2563eb',
    verde: '#16a34a',
    amarelo: '#ca8a04',
    vermelho: '#dc2626',
    roxo: '#9333ea',
    cinza: '#64748b',
  };
  return map[key ?? ''] ?? '#94a3b8';
}

function DepartmentFormDrawer({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Department | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    colorKey: '' as string,
    isActive: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: initial?.name ?? '',
        description: initial?.description ?? '',
        colorKey: initial?.colorKey ?? '',
        isActive: initial?.isActive ?? true,
      });
      setErrors({});
      setServerError(null);
    }
  }, [open, initial]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setServerError(null);
    const local: Record<string, string> = {};
    if (form.name.trim().length < 2) local.name = 'Nome do setor precisa ter ao menos 2 caracteres.';
    if (form.name.trim().length > 80) local.name = 'Nome do setor pode ter no máximo 80 caracteres.';
    if (form.description.trim().length > 500) local.description = 'Descrição pode ter no máximo 500 caracteres.';
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        colorKey: form.colorKey || null,
        isActive: form.isActive,
      };
      const r = initial
        ? await api<{ ok: boolean; department: Department }>(`/api/v1/admin/departments/${initial.id}`, {
            method: 'PATCH',
            body,
          })
        : await api<{ ok: boolean; department: Department }>('/api/v1/admin/departments', {
            method: 'POST',
            body,
          });
      onSaved(r.ok ? (initial ? 'Setor atualizado.' : 'Setor cadastrado.') : 'Operação concluída.');
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(err.details)) mapped[k] = (v as string[])[0] ?? '';
          setErrors(mapped);
        }
      } else {
        setServerError('Erro inesperado ao salvar o setor.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={initial ? 'Editar setor' : 'Cadastrar setor'}
      subtitle={initial ? initial.name : 'Novo setor organizacional'}
      width="max-w-xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" form="dept-form" disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="dept-form" onSubmit={submit} className="space-y-4">
        {serverError && (
          <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30">{serverError}</div>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Nome *</span>
          <input className={inputClass(!!errors.name)} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={80} />
          {errors.name && <span className="mt-1 block text-xs text-danger-600">{errors.name}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Descrição</span>
          <textarea className={inputClass(!!errors.description)} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={500} rows={3} />
          {errors.description && <span className="mt-1 block text-xs text-danger-600">{errors.description}</span>}
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Cor institucional</span>
            <select className={inputClass(false)} value={form.colorKey} onChange={(e) => setForm((f) => ({ ...f, colorKey: e.target.value }))}>
              <option value="">—</option>
              {DEPARTMENT_COLORS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pt-7">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            <span className="text-sm text-slate-700">Ativo</span>
          </label>
        </div>
      </form>
    </Drawer>
  );
}

export type { Paginated, PublicUser, SessionUser };
export { qs };
