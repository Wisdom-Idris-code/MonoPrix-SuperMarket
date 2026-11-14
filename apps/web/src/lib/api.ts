export type FieldError = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: FieldError[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
    const message = typeof errorObj.error === 'string'
      ? errorObj.error
      : `Request failed (${response.status}).`;
    const code = typeof errorObj.code === 'string' ? errorObj.code : undefined;
    const details = Array.isArray(errorObj.details)
      ? (errorObj.details as FieldError[])
      : undefined;
    throw new ApiError(message, response.status, code, details);
  }
  if (result && typeof result === 'object' && 'data' in result) {
    return result.data as T;
  }
  return result as T;
}

export function apiGet<T>(path: string) {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown, headers?: HeadersInit) {
  return request<T>(path, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers,
  });
}

export function apiPatch<T>(path: string, body: unknown) {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string) {
  return request<T>(path, { method: 'DELETE' });
}

export function apiUpload<T>(path: string, body: FormData) {
  return request<T>(path, { method: 'POST', body });
}
