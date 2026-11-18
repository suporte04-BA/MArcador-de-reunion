import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionUser } from '@agenda/shared';
import { api, ApiError } from '../lib/api';
import { ToastProvider, useToast } from '../lib/toast';
import { Avatar, Spinner } from '../components/ui';
import LoginPage from '../features/auth/LoginPage';
import ChangePasswordModal from '../features/auth/ChangePasswordModal';
import MeetingsTab from '../features/meetings/MeetingsTab';
import UsersTab from '../features/users/UsersTab';

type Tab = 'meetings' | 'users';

type UrlParams = {
  convite: string | null;
  redefinir: string | null;
  reuniao: string | null;
};

function readUrlParams(): UrlParams {
  const p = new URLSearchParams(window.location.search);
  return {
    convite: p.get('convite'),
    redefinir: p.get('redefinir'),
    reuniao: p.get('reuniao'),
  };
}

function clearUrlParams(): void {
  window.history.replaceState({}, '', window.location.pathname);
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

function AppShell() {
  const toast = useToast();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>('meetings');
  const [urlParams, setUrlParams] = useState<UrlParams>(readUrlParams);
  const [changeOpen, setChangeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pendingMeetingId, setPendingMeetingId] = useState<string | null>(urlParams.reuniao);
  const profileRef = useRef<HTMLDivElement | null>(null);

  const authMode: 'login' | 'invite' | 'reset' = urlParams.convite
    ? 'invite'
    : urlParams.redefinir
      ? 'reset'
      : 'login';
  const authToken = urlParams.convite ?? urlParams.redefinir;

  // Restaura a sessão ao carregar.
  useEffect(() => {
    let active = true;
    api<{ user: SessionUser }>('/api/v1/auth/me')
      .then((r) => {
        if (active) setUser(r.user);
      })
      .catch(() => {
        /* sem sessão — permanece no login */
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Fecha o menu de perfil ao clicar fora.
  useEffect(() => {
    if (!profileOpen) return;
    const onDoc = (e: MouseEvent): void => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [profileOpen]);

  const handleLoggedIn = useCallback((u: SessionUser, mustChange: boolean) => {
    setUser(u);
    if (mustChange) setChangeOpen(true);
    if (pendingMeetingId) {
      setTab('meetings');
      setUrlParams((p) => ({ ...p, reuniao: null }));
      clearUrlParams();
    }
  }, [pendingMeetingId]);

  const handleLogout = useCallback(async () => {
    try {
      await api('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      /* sessão pode já estar inválida */
    }
    setUser(null);
    setTab('meetings');
    setProfileOpen(false);
    toast.push('Sessão encerrada.');
  }, [toast]);

  const handleTokenConsumed = useCallback(() => {
    setUrlParams((p) => ({ ...p, convite: null, redefinir: null }));
    clearUrlParams();
  }, []);

  if (booting) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Spinner label="Carregando a Agenda BA…" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        initialToken={authToken}
        initialMode={authMode}
        onLoggedIn={handleLoggedIn}
        onTokenConsumed={handleTokenConsumed}
      />
    );
  }

  const isAdmin = user.role === 'ADMIN';
  const activeTab: Tab = tab === 'users' && !isAdmin ? 'meetings' : tab;

  return (
    <div className="flex min-h-full flex-col">
      {/* ---------------------------- Cabeçalho ---------------------------- */}
      <header className="sticky top-0 z-40 bg-navy-900 text-white shadow-lg">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/brand/logo-ba.png"
              alt="BA Elétrica"
              className="h-9 w-auto shrink-0 object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-base font-bold">Agenda BA</div>
              <div className="hidden truncate text-[11px] text-brand-200 sm:block">
                Agenda Corporativa | BA Elétrica
              </div>
            </div>
          </div>

          {/* Abas principais: exatamente duas (Usuários somente para ADMIN) */}
          <nav className="ml-2 flex items-center gap-1" aria-label="Navegação principal">
            <TabButton active={activeTab === 'meetings'} onClick={() => setTab('meetings')}>
              Reuniões
            </TabButton>
            {isAdmin && (
              <TabButton active={activeTab === 'users'} onClick={() => setTab('users')}>
                Usuários
              </TabButton>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/10"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
              >
                <Avatar name={user.fullName} src={user.avatarUrl} size={30} />
                <span className="hidden max-w-40 truncate text-sm font-medium sm:block">{user.fullName}</span>
                <span className="text-xs text-brand-200">▾</span>
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-60 animate-fade rounded-xl bg-white py-1.5 text-slate-800 shadow-xl ring-1 ring-slate-200" role="menu">
                  <div className="border-b border-slate-100 px-4 py-2.5">
                    <div className="truncate text-sm font-semibold">{user.fullName}</div>
                    <div className="truncate text-xs text-slate-500">@{user.username}</div>
                    <div className="mt-1 text-[11px] font-medium text-brand-700">
                      {isAdmin ? 'Administrador' : 'Usuário'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      setChangeOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                  >
                    Alterar senha
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleLogout()}
                    className="w-full px-4 py-2.5 text-left text-sm text-danger-600 hover:bg-danger-50"
                  >
                    Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ----------------------------- Conteúdo ---------------------------- */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {activeTab === 'meetings' ? (
          <MeetingsTab
            currentUser={user}
            openMeetingId={pendingMeetingId}
            onOpenMeetingConsumed={() => setPendingMeetingId(null)}
          />
        ) : (
          <UsersTab currentUser={user} />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
        Agenda BA — Agenda Corporativa | BA Elétrica · Fuso horário America/Manaus
      </footer>

      <ChangePasswordModal
        open={changeOpen}
        forced={user.mustChangePassword}
        onClose={() => setChangeOpen(false)}
        onDone={() => {
          setChangeOpen(false);
          setUser({ ...user, mustChangePassword: false });
        }}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        active ? 'bg-white text-navy-900 shadow' : 'text-brand-100 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

export { ApiError };
