import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { Drawer } from '../../components/ui';
import { inputClass } from './LoginPage';
import { useToast } from '../../lib/toast';

/** Troca de senha (manual ou forçada — senha temporária administrativa). */
export default function ChangePasswordModal({
  open,
  forced = false,
  onClose,
  onDone,
}: {
  open: boolean;
  forced?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setErrors({});
    if (next !== confirm) {
      setErrors({ confirm: 'As senhas não coincidem.' });
      return;
    }
    setBusy(true);
    try {
      await api('/api/v1/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      toast.success('Senha alterada com sucesso.');
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(err.details)) mapped[k] = v[0] ?? '';
          setErrors(mapped);
        }
      } else {
        setError('Erro inesperado ao alterar a senha.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={forced ? () => undefined : onClose}
      title={forced ? 'Defina uma nova senha' : 'Alterar senha'}
      subtitle={
        forced
          ? 'Sua conta foi criada com uma senha temporária. Crie uma nova senha para continuar.'
          : 'A alteração encerra as demais sessões abertas da sua conta.'
      }
      width="max-w-md"
      footer={
        <button
          type="submit"
          form="change-password-form"
          disabled={busy}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-60"
        >
          {busy ? 'Salvando…' : 'Salvar nova senha'}
        </button>
      }
    >
      <form id="change-password-form" onSubmit={submit} className="space-y-4">
        {!forced && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Senha atual</span>
            <input
              className={inputClass(!!errors.currentPassword)}
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
              autoFocus
            />
            {errors.currentPassword && (
              <span className="mt-1 block text-xs text-danger-600">{errors.currentPassword}</span>
            )}
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Nova senha</span>
          <input
            className={inputClass(!!errors.newPassword)}
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={4}
            required
            autoFocus={forced}
          />
          <span className="mt-1 block text-xs text-slate-400">Mínimo de 4 caracteres.</span>
          {errors.newPassword && <span className="mt-1 block text-xs text-danger-600">{errors.newPassword}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Confirmar nova senha</span>
          <input
            className={inputClass(!!errors.confirm)}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={4}
            required
          />
          {errors.confirm && <span className="mt-1 block text-xs text-danger-600">{errors.confirm}</span>}
        </label>

        {error && (
          <div className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/30" role="alert">
            {error}
          </div>
        )}
      </form>
    </Drawer>
  );
}
