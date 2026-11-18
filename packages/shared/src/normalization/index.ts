/**
 * Normalização compartilhada de identificadores de acesso.
 *
 * Regra única (Revisão V2 §4.2), usada em criação de usuário, login,
 * redefinição de senha e checagem de duplicidade:
 *
 *   1. Unicode NFKC;
 *   2. trim (espaços nas pontas);
 *   3. colapsar sequências de espaços internos em um único espaço;
 *   4. lowercase determinístico;
 *   5. remover diacríticos APENAS na chave de comparação.
 *
 * O nome exibido (`full_name`, `username` gravado) NUNCA passa por aqui:
 * `Sérgio Rodrigues` continua sendo exibido com caixa e acentos.
 *
 * A chave produzida aqui precisa ser idêntica à função SQL
 * `agenda_normalize_key()` (database/migrations/003_departments.sql) —
 * a paridade é garantida pelo teste de integração que compara as duas.
 */

/** Transliteração de caracteres sem decomposição canônica (espelha `unaccent`). */
const NON_DECOMPOSABLE: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ı: 'i',
  ŋ: 'n',
  ħ: 'h',
  ŧ: 't',
};

const NON_DECOMPOSABLE_RE = /[ßæœøđðþłıŋħŧ]/g;

/**
 * Chave de comparação de username/e-mail: sem caixa, sem acento e sem
 * espaços repetidos. É o valor gravado em `users.username_key` /
 * `users.email_key` e usado no login.
 *
 * @example usernameKey('  Sérgio   Rodrigues  ') === 'sergio rodrigues'
 * @example usernameKey('JOSE DA SILVA')          === 'jose da silva'
 */
export function usernameKey(value: string): string {
  const trimmed = value.normalize('NFKC').trim();
  const collapsed = trimmed.replace(/\s+/g, ' ');
  const lower = collapsed.toLowerCase();
  const ascii = lower.replace(NON_DECOMPOSABLE_RE, (ch) => NON_DECOMPOSABLE[ch] ?? ch);
  const withoutMarks = ascii.normalize('NFD').replace(/\p{M}+/gu, '');
  return withoutMarks.normalize('NFC');
}

/**
 * Chave de comparação de nome de setor (duplicidade ignorando caixa,
 * espaços repetidos e acentuação — Revisão V2 §2.1).
 */
export function departmentKey(value: string): string {
  return usernameKey(value);
}

/**
 * Slug interno de setor, recalculado sempre no servidor
 * (o cliente nunca envia slug — Revisão V2 §2.1).
 *
 * @example departmentSlug('Administrador/TI') === 'administrador-ti'
 */
export function departmentSlug(value: string): string {
  return usernameKey(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
