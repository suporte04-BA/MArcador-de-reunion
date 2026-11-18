import { z } from 'zod';

/** Mensagem de erro padrão em pt-BR para campos obrigatórios. */
export const required = (label: string): string => `${label} é obrigatório.`;

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Nome de usuário precisa ter ao menos 3 caracteres.')
  .max(60, 'Nome de usuário pode ter no máximo 60 caracteres.')
  .regex(
    /^[\p{L}\p{N} ._-]+$/u,
    'Nome de usuário só pode conter letras, números, espaços, ponto, hífen e sublinhado.',
  );

/**
 * Senha mínima: **4 caracteres** (Revisão V2 §3.5).
 * Regra única aplicada nas duas camadas (API e UI) — não elevar
 * silenciosamente para 8/12 sem autorização.
 */
export const PASSWORD_MIN_LENGTH = 4;

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  )
  .max(200, 'A senha pode ter no máximo 200 caracteres.');

export const emailSchema = z
  .string()
  .trim()
  .min(5, 'E-mail inválido.')
  .max(254, 'E-mail pode ter no máximo 254 caracteres.')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'E-mail inválido.');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Nome completo é obrigatório.')
  .max(120, 'Nome completo pode ter no máximo 120 caracteres.');

/* ---------------------------- Autenticação ---------------------------- */

export const loginSchema = z.object({
  username: z.string().trim().min(1, required('Nome de usuário')),
  password: z.string().min(1, required('Senha')),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    /*
     * Opcional: na troca forçada (senha temporária administrativa) a UI não
     * exibe o campo "senha atual" — a sessão já foi aberta com a senha
     * temporária. A rota só exige a senha atual quando a troca não é forçada.
     */
    currentPassword: z.string().optional().default(''),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'A nova senha deve ser diferente da senha atual.',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const activateInvitationSchema = z.object({
  token: z.string().trim().min(10, 'Token de convite inválido.'),
  password: passwordSchema,
});
export type ActivateInvitationInput = z.infer<typeof activateInvitationSchema>;

export const requestPasswordResetSchema = z.object({
  identifier: z.string().trim().min(1, required('Usuário ou e-mail')),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const completePasswordResetSchema = z.object({
  token: z.string().trim().min(10, 'Token inválido.'),
  password: passwordSchema,
});
export type CompletePasswordResetInput = z.infer<typeof completePasswordResetSchema>;

/* ------------------------------ Reuniões ------------------------------ */

export const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato aaaa-mm-dd.')
  .refine((v) => {
    const parts = v.split('-').map(Number);
    const y = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    const d = parts[2] ?? 0;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    );
  }, 'Data inexistente.');

export const timeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/, 'Hora deve estar no formato HH:MM.')
  .refine((v) => {
    const parts = v.split(':').map(Number);
    const h = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, 'Hora inválida.');

export const meetingBaseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Assunto precisa ter ao menos 3 caracteres.')
    .max(200, 'Assunto pode ter no máximo 200 caracteres.'),
  responsibleName: z
    .string()
    .trim()
    .min(2, 'Responsável é obrigatório.')
    .max(120, 'Responsável pode ter no máximo 120 caracteres.'),
  date: dateSchema,
  start: timeSchema,
  end: timeSchema,
  description: z
    .string()
    .trim()
    .min(5, 'Descrição precisa ter ao menos 5 caracteres.')
    .max(4000, 'Descrição pode ter no máximo 4000 caracteres.'),
  observations: z
    .string()
    .trim()
    .max(4000, 'Observações podem ter no máximo 4000 caracteres.')
    .optional()
    .or(z.literal('')),
  /**
   * Setor da reunião (V2 §6): obrigatório em criação e opcional em edição
   * parcial. O backend valida que o setor existe e está ativo.
   */
  departmentId: z.string().uuid(required('Setor da reunião')),
});

export const createMeetingSchema = meetingBaseSchema.refine(
  (v) => v.end > v.start,
  { message: 'A hora de término deve ser posterior à hora de início.', path: ['end'] },
);
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = meetingBaseSchema
  .partial()
  .refine((v) => v.start === undefined || v.end === undefined || v.end > v.start, {
    message: 'A hora de término deve ser posterior à hora de início.',
    path: ['end'],
  });
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const availabilityQuerySchema = z.object({
  date: dateSchema,
  start: timeSchema,
  end: timeSchema,
  excludeId: z.string().trim().optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const listMeetingsQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  status: z.enum(['SCHEDULED', 'CANCELLED', 'ALL']).optional(),
  createdByMe: z.enum(['true', 'false']).optional(),
  /** Filtro por setor da reunião (V2 §6). */
  departmentId: z.string().trim().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;

/* ------------------------------ Usuários ------------------------------ */

export const createUserSchema = z.object({
  fullName: fullNameSchema,
  username: usernameSchema,
  email: emailSchema,
  role: z.enum(['ADMIN', 'USER']),
  /** Setor organizacional obrigatório (V2 §3.4) — não confundir com `role`. */
  departmentId: z.string().uuid(required('Setor')),
  sendInvitation: z.boolean().optional().default(true),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: fullNameSchema.optional(),
  username: usernameSchema.optional(),
  email: emailSchema.optional(),
  departmentId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE']).optional(),
  password: passwordSchema.optional().or(z.literal('')),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/* ------------------------------- Setores ------------------------------ */

/** Cores institucionais permitidas (V2 §2.1 — contraste acessível). */
export const DEPARTMENT_COLORS = [
  'azul',
  'verde',
  'amarelo',
  'vermelho',
  'roxo',
  'cinza',
] as const;

export const departmentColorSchema = z.enum(DEPARTMENT_COLORS);

export const createDepartmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome do setor precisa ter ao menos 2 caracteres.')
    .max(80, 'Nome do setor pode ter no máximo 80 caracteres.'),
  description: z
    .string()
    .trim()
    .max(500, 'Descrição pode ter no máximo 500 caracteres.')
    .optional()
    .or(z.literal('')),
  colorKey: departmentColorSchema.optional().nullable(),
  isActive: z.boolean().optional().default(true),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial();
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;


export const testEmailSchema = z.object({
  userId: z.string().trim().min(1, required('Usuário')),
  confirm: z.literal(true, { message: 'Confirme o envio do e-mail de teste.' }),
});
export type TestEmailInput = z.infer<typeof testEmailSchema>;

/** Converte erros do zod em um objeto campo -> mensagem. */
export function formatZodIssues(
  error: z.ZodError,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
