/** Tipos de domínio compartilhados entre API e interface. */

export type Role = 'ADMIN' | 'USER';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';
export type MeetingStatus = 'SCHEDULED' | 'CANCELLED';
export type OutboxStatus = 'PENDING' | 'SENDING' | 'SENT' | 'RETRYING' | 'FAILED';
export type OutboxEventType =
  | 'INVITE'
  | 'WELCOME'
  | 'MEETING_CREATED'
  | 'MEETING_UPDATED'
  | 'MEETING_CANCELLED'
  | 'MEETING_REMINDER'
  | 'TEST_EMAIL'
  | 'PASSWORD_RESET';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  /** Setor organizacional do usuário (V2 §6 — pré-seleção no formulário de reunião). */
  departmentId: string | null;
}

export interface PublicUser {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: Role;
  status: UserStatus;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  meetingCount: number;
  /** Setor organizacional (V2 §1.2) — NÃO confundir com `role`. */
  departmentId: string | null;
  departmentName: string | null;
  departmentColorKey: string | null;
}

/** Cor institucional pré-definida (V2 §2.1 — sem cores arbitrárias). */
export type DepartmentColorKey =
  | 'azul'
  | 'verde'
  | 'amarelo'
  | 'vermelho'
  | 'roxo'
  | 'cinza';

export interface Department {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  colorKey: DepartmentColorKey | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Contagens reais de vínculo (V2 §3.1/§2.1). */
  activeUserCount: number;
  meetingCount: number;
}

/** Setor com contagens reais de vínculo (subaba Setores / KPI). */
export interface DepartmentWithCounts extends Department {
  activeUserCount: number;
  meetingCount: number;
}

/** Resumo de um setor para o painel interno de detalhe. */
export interface DepartmentSummary {
  department: Department;
  users: Array<{
    id: string;
    fullName: string;
    username: string;
    status: UserStatus;
    role: Role;
  }>;
  meetings: Array<{
    id: string;
    title: string;
    startsAt: string;
    status: MeetingStatus;
    createdByName: string;
  }>;
}

/** Contagens reais exibidas nas KPIs da área Usuários (V2 §3.1). */
export interface AdminStats {
  users: { total: number; active: number; inactive: number; pending: number };
  departments: { total: number; active: number; inactive: number };
}


export interface Meeting {
  id: string;
  title: string;
  responsibleName: string;
  startsAt: string;
  endsAt: string;
  description: string;
  observations: string | null;
  status: MeetingStatus;
  /** Setor da reunião (V2 §6) — obrigatório em novos registros. */
  departmentId: string | null;
  departmentName: string | null;
  departmentColorKey: string | null;
  createdByUserId: string;
  createdByName: string;
  createdByUsername: string;
  createdByAvatarUrl: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  /** true quando a sessão atual pode editar/excluir (autor ou ADMIN). */
  canManage: boolean;
}

export interface MeetingMetrics {
  today: number;
  todayNext: Meeting | null;
  upcoming: number;
  upcomingNext: Meeting | null;
  month: number;
  createdByMe: number;
  total: number;
  cancelled: number;
}

export interface DayAgendaItem {
  id: string;
  title: string;
  responsibleName: string;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  createdByName: string;
  createdByAvatarUrl: string | null;
  canManage: boolean;
}

export interface AvailabilityResponse {
  date: string;
  start: string;
  end: string;
  available: boolean;
  conflicts: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    responsibleName: string;
  }>;
}

export interface OutboxEntry {
  id: string;
  eventType: OutboxEventType;
  recipientName: string;
  recipientEmail: string;
  status: OutboxStatus;
  attemptCount: number;
  lastError: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface EmailStatus {
  mode: 'smtp' | 'disabled';
  host: string;
  port: number;
  secure: boolean;
  from: string;
  fromName: string;
  pending: number;
  sent: number;
  failed: number;
  retrying: number;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  entityType: string;
  entityLabel: string | null;
  metadata: Record<string, unknown> | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}
