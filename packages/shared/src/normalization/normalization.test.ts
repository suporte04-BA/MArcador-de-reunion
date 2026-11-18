import { describe, expect, it } from 'vitest';
import { departmentKey, departmentSlug, usernameKey } from './index.js';

describe('usernameKey (Revisão V2 §4.2)', () => {
  it('colapsa para a mesma chave: caixa, acento e espaços repetidos', () => {
    const esperada = 'sergio rodrigues';
    expect(usernameKey('Sérgio Rodrigues')).toBe(esperada);
    expect(usernameKey('sérgio rodrigues')).toBe(esperada);
    expect(usernameKey('SERGIO RODRIGUES')).toBe(esperada);
    expect(usernameKey('Sergio   Rodrigues')).toBe(esperada);
    expect(usernameKey('  Sergio   Rodrigues  ')).toBe(esperada);
    expect(usernameKey('Sergio\t\n  Rodrigues')).toBe(esperada);
  });

  it('preserva a forma sem acento já cadastrada', () => {
    expect(usernameKey('JOSE DA SILVA')).toBe('jose da silva');
    expect(usernameKey('José   da   Silva')).toBe('jose da silva');
    expect(usernameKey('josé da silva')).toBe('jose da silva');
  });

  it('aplica NFKC (caracteres compostos/compatíveis)', () => {
    // 'ﬁ' (ligadura) em NFKC vira 'fi'
    expect(usernameKey('ﬁscal')).toBe('fiscal');
    // 'ｅ' fullwidth em NFKC vira 'e'
    expect(usernameKey('ａｄｍｉｎ')).toBe('admin');
  });

  it('remove diacríticos apenas na chave (não altera o original)', () => {
    const original = 'José da Silva';
    expect(usernameKey(original)).toBe('jose da silva');
    expect(original).toBe('José da Silva'); // imutável
  });

  it('não quebra username com ponto, hífen e sublinhado', () => {
    expect(usernameKey('joao.silva-2_local')).toBe('joao.silva-2_local');
    expect(usernameKey('JOAO.SILVA-2_LOCAL')).toBe('joao.silva-2_local');
  });

  it('trata caractere sem decomposição (ß, ø, ł)', () => {
    expect(usernameKey('Straße')).toBe('strasse');
    expect(usernameKey('Łukasz')).toBe('lukasz');
    expect(usernameKey('smør')).toBe('smor');
  });

  it('string vazia e espaços viram chave vazia', () => {
    expect(usernameKey('')).toBe('');
    expect(usernameKey('    ')).toBe('');
  });

  it('é idempotente (aplicar duas vezes não muda)', () => {
    const k = usernameKey('  Sérgio   Rodrigues  ');
    expect(usernameKey(k)).toBe(k);
  });

  it('não é sensível a caixa no resultado', () => {
    expect(usernameKey('Admin')).toBe(usernameKey('ADMIN'));
    expect(usernameKey('Admin')).toBe(usernameKey('admin'));
  });
});

describe('departmentKey', () => {
  it('ignora caixa, espaços repetidos e acentos (V2 §2.1)', () => {
    const esperado = 'fiscal';
    expect(departmentKey('Fiscal')).toBe(esperado);
    expect(departmentKey('FISCAL')).toBe(esperado);
    expect(departmentKey('fiscal')).toBe(esperado);
    expect(departmentKey('  Fis-cal  ')).toBe('fis-cal');
  });

  it('setores distintos continuam distintos', () => {
    expect(departmentKey('Administrador/TI')).not.toBe(departmentKey('Financeiro'));
    expect(departmentKey('Fiscal')).not.toBe(departmentKey('Financeiro'));
  });
});

describe('departmentSlug', () => {
  it('gera slug no servidor a partir do nome', () => {
    expect(departmentSlug('Administrador/TI')).toBe('administrador-ti');
    expect(departmentSlug('Fiscal')).toBe('fiscal');
    expect(departmentSlug('Financeiro')).toBe('financeiro');
    expect(departmentSlug('  Compras e  Obras ')).toBe('compras-e-obras');
    expect(departmentSlug('Ação Corretiva')).toBe('acao-corretiva');
  });

  it('não deixa hífen nas pontas', () => {
    expect(departmentSlug('--Fiscal--')).toBe('fiscal');
  });
});
