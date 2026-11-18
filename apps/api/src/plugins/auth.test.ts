import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@agenda/shared';
import { canManageMeeting } from './auth';

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    username: 'maria',
    fullName: 'Maria Souza',
    email: 'maria@baeletrica.com.br',
    role: 'USER',
    status: 'ACTIVE',
    avatarUrl: null,
    mustChangePassword: false,
    ...overrides,
  };
}

const meeting = { createdByUserId: 'user-1' };

describe('canManageMeeting — regra central de autorização', () => {
  it('o autor da reunião pode gerenciar', () => {
    expect(canManageMeeting(user({ id: 'user-1' }), meeting)).toBe(true);
  });

  it('outro usuário comum NÃO pode gerenciar', () => {
    expect(canManageMeeting(user({ id: 'user-2', username: 'joao' }), meeting)).toBe(false);
  });

  it('administrador pode gerenciar reunião de qualquer um', () => {
    expect(
      canManageMeeting(user({ id: 'admin-9', role: 'ADMIN', username: 'admin' }), meeting),
    ).toBe(true);
  });

  it('administrador autoriando a própria reunião continua podendo', () => {
    const adminCreated = { createdByUserId: 'admin-9' };
    expect(canManageMeeting(user({ id: 'admin-9', role: 'ADMIN' }), adminCreated)).toBe(true);
  });

  it('usuário inativo/logado com id diferente não ganha permissão', () => {
    const inactiveOther = user({ id: 'user-3', status: 'INACTIVE' });
    expect(canManageMeeting(inactiveOther, meeting)).toBe(false);
  });

  it('o campo "responsável" do texto não influencia a regra', () => {
    // Responsável é apenas texto digitado — quem não é autor continua sem permissão,
    // mesmo que o nome do responsável seja igual ao do usuário.
    const impostor = user({ id: 'user-2', fullName: 'João da Silva' });
    expect(canManageMeeting(impostor, { createdByUserId: 'user-1' })).toBe(false);
  });
});
