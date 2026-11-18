import { query } from '../../config/db.js';

export type AuditActor = {
  id: string;
  fullName: string;
  username: string;
} | null;

export type AuditInput = {
  actor?: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Registra uma operação relevante na trilha de auditoria.
 * Nunca registra senhas, tokens completos ou segredos.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (actor_user_id, actor_name, action, entity_type, entity_id, entity_label, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.actor?.id ?? null,
        input.actor ? `${input.actor.fullName} (${input.actor.username})` : 'sistema',
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.entityLabel ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  } catch (err) {
    // Auditoria nunca pode derrubar o fluxo principal, mas o erro é visível.
    console.error('[AUDIT] Falha ao registrar auditoria:', err instanceof Error ? err.message : err);
  }
}
