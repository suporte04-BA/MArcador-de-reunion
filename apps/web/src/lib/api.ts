/**
 * Cliente HTTP da Agenda BA.
 * - Mesma origem em produção (a API entrega o SPA) e proxy do Vite em dev.
 * - Erros viram ApiError com status, código e detalhes de validação.
 * - Sessão: cookie HttpOnly gerenciado pelo servidor (nada de token no JS).
 */

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, string[]>;
  conflicts?: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    responsibleName: string;
  }>;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Partial<Pick<ApiError, 'details' | 'conflicts'>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = extra.details;
    this.conflicts = extra.conflicts;
  }

  /** Primeira mensagem de validação de um campo, se houver. */
  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

/** Chamada central: lança ApiError em qualquer resposta não-2xx. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK',
      'Não foi possível falar com o servidor. Verifique a conexão e tente novamente.',
    );
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      `Falha inesperada na requisição (HTTP ${response.status}).`;
    const code = (payload as { code?: string } | null)?.code ?? 'UNKNOWN';
    throw new ApiError(response.status, code, message, {
      details: (payload as { details?: Record<string, string[]> } | null)?.details,
      conflicts: (payload as { conflicts?: ApiError['conflicts'] } | null)?.conflicts,
    });
  }

  return payload as T;
}

/** Monta query string ignorando valores vazios. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
