export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Failures that mean "the backend is not usable" (as opposed to a normal 4xx answer from it). */
export function isConnectivityError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504;
}
