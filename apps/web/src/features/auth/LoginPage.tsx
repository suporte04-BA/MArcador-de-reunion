import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import type { SessionUser } from '@agenda/shared';

type Mode = 'login' | 'invite' | 'reset';

type LoginResponse = { user: SessionUser; mustChangePassword: boolean };

/**
 * Tela de acesso com três modos:
 * - login (padrão)
 * - ativação de convite (?convite=TOKEN) — o usuário define a própria senha
 * - redefinição de senha (?redefinir=TOKEN) — link recebido por e-mail
 */
export default function LoginPage({
  initialToken,
  initialMode,
  onLoggedIn,
  onTokenConsumed,
}: {
  initialToken: string | null;
  initialMode: Mode;
  onLoggedIn: (user: SessionUser, mustChangePassword: boolean) => void;
  onTokenConsumed: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialToken ? initialMode : 'login');
  const [token] = useState(initialToken);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteInfo, setInviteInfo] = useState<{ fullName: string; username: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pré-carrega os dados do convite para exibir nome/usuário.
  useEffect(() => {
    if (mode !== 'invite' || !token) return;
    let active = true;
    api<{ fullName: string; username: string }>('/api/v1/auth/accept-invite-preview', {
      method: 'POST',
      body: { token },
    })
      .then((r) => {
        if (active) setInviteInfo(r);
      })
      .catch((err: ApiError) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [mode, token]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setFieldErrors({});
    setBusy(true);
    try {
      if (mode === 'login') {
        const r = await api<LoginResponse>('/api/v1/auth/login', {
          method: 'POST',
          body: { username: identifier.trim(), password },
        });
        onLoggedIn(r.user, r.mustChangePassword);
        return;
      }

      if (mode === 'invite') {
        if (newPassword !== confirmPassword) {
          setFieldErrors({ confirmPassword: 'As senhas não coincidem.' });
          setBusy(false);
          return;
        }
        await api('/api/v1/auth/activate-invitation', {
          method: 'POST',
          body: { token, password: newPassword },
        });
        setInfo('Acesso ativado com sucesso! Entre com seu usuário e senha.');
        setMode('login');
        setIdentifier(inviteInfo?.username ?? '');
        setPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onTokenConsumed();
        return;
      }

      // reset
      if (newPassword !== confirmPassword) {
        setFieldErrors({ confirmPassword: 'As senhas não coincidem.' });
        setBusy(false);
        return;
      }
      await api('/api/v1/auth/complete-password-reset', {
        method: 'POST',
        body: { token, password: newPassword },
      });
      setInfo('Senha redefinida com sucesso! Entre com sua nova senha.');
      setMode('login');
      setNewPassword('');
      setConfirmPassword('');
      onTokenConsumed();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(err.details)) mapped[k] = v[0] ?? '';
          setFieldErrors(mapped);
        }
      } else {
        setError('Erro inesperado. Tente novamente.');
      }
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'invite'
      ? 'Ative seu acesso'
      : mode === 'reset'
        ? 'Crie uma nova senha'
        : 'Entre na sua conta';

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-brand-800 p-4">
      <div className="w-full max-w-md animate-fade rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src="/brand/logo-ba.png"
            alt="BA Elétrica"
            className="mb-3 h-16 w-auto object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <h1 className="text-2xl font-bold text-navy-900">Agenda BA</h1>
          <p className="mt-1 text-sm text-slate-500">Agenda Corporativa | BA Elétrica</p>
        </div>

        <h2 className="text-center text-base font-semibold text-slate-800">{title}</h2>

        <form onSubmit={submit} className="mt-4 space-y-4">
          {mode === 'login' && (
            <>
              <Field label="Usuário" error={fieldErrors.identifier}>
                <input
                  className={inputClass(!!fieldErrors.identifier)}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </Field>
              <Field label="Senha" error={fieldErrors.password}>
                <input
                  className={inputClass(!!fieldErrors.password)}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>
            </>
          )}

          {mode === 'invite' && (
            <>
              {inviteInfo ? (
                <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800 ring-1 ring-brand-600/20">
                  Convite de <strong>{inviteInfo.fullName}</strong> (@{inviteInfo.username}).
                  Defina uma senha para ativar seu acesso.
                </div>
              ) : token ? (
                <p className="text-sm text-slate-500">Verificando convite…</p>
              ) : null}
              <Field label="Nova senha" hint="Mínimo de 4 caracteres." error={fieldErrors.password}>
                <input
                  className={inputClass(!!fieldErrors.password)}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={4}
                  required
                />
              </Field>
              <Field label="Confirmar nova senha" error={fieldErrors.confirmPassword}>
                <input
                  className={inputClass(!!fieldErrors.confirmPassword)}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={4}
                  required
                />
              </Field>
            </>
          )}

          {mode === 'reset' && (
            <>
              <p className="rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-600 ring-1 ring-warning-600/20">
                Escolha uma nova senha para a sua conta. O link expira em 60 minutos.
              </p>
              <Field label="Nova senha" hint="Mínimo de 4 caracteres." error={fieldErrors.password}>
                <input
                  className={inputClass(!!fieldErrors.password)}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={4}
                  required
                />
              </Field>
              <Field label="Confirmar nova senha" error={fieldErrors.confirmPassword}>
                <input
                  className={inputClass(!!fieldErrors.confirmPassword)}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={4}
                  required
                />
              </Field>
            </>
          )}

          {error && (
            <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30" role="alert">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-lg bg-success-50 px-4 py-3 text-sm text-success-600 ring-1 ring-success-600/30" role="status">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || (mode === 'invite' && !inviteInfo)}
            className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-60"
          >
            {busy
              ? 'Aguarde…'
              : mode === 'login'
                ? 'Entrar'
                : mode === 'invite'
                  ? 'Ativar meu acesso'
                  : 'Redefinir senha'}
          </button>
        </form>

        {mode === 'login' && (
          <p className="mt-5 text-center text-xs text-slate-400">
            Acesso problemático? Procure o administrador do sistema.
          </p>
        )}

        {mode !== 'login' && (
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                onTokenConsumed();
              }}
              className="text-sm text-brand-700 hover:underline"
            >
              ← Voltar para o login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-danger-600">{error}</span> : null}
    </label>
  );
}

export function inputClass(invalid: boolean): string {
  return [
    'w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition',
    'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25',
    invalid ? 'border-danger-600 bg-danger-50/40' : 'border-slate-300 bg-white',
  ].join(' ');
}
