export type FaultOrigin =
  | 'upstream-sync'
  | 'wasm-build'
  | 'runtime-core'
  | 'runtime-worker'
  | 'runtime-api'
  | 'ci';

export type FaultSeverity = 'info' | 'warn' | 'error' | 'fatal';

export type FaultCategory =
  | 'build'
  | 'initialization'
  | 'memory'
  | 'model'
  | 'inference'
  | 'protocol';

export interface FaultDetails {
  category: FaultCategory;
  code: string;
  origin: FaultOrigin;
  severity: FaultSeverity;
  recoverable: boolean;
  message: string;
  context?: Record<string, unknown> | undefined;
  cause?: unknown;
}

export interface SerializableFault extends Omit<FaultDetails, 'cause'> {
  name: 'WasmlLlamaError';
  context?: Record<string, unknown> | undefined;
}

export class WasmlLlamaError extends Error {
  readonly category: FaultCategory;
  readonly code: string;
  readonly origin: FaultOrigin;
  readonly severity: FaultSeverity;
  readonly recoverable: boolean;
  readonly context: Record<string, unknown> | undefined;
  readonly cause: unknown;

  constructor(details: FaultDetails) {
    super(details.message);
    this.name = 'WasmlLlamaError';
    this.category = details.category;
    this.code = details.code;
    this.origin = details.origin;
    this.severity = details.severity;
    this.recoverable = details.recoverable;
    this.context = details.context;
    this.cause = details.cause;
  }

  toJSON(): SerializableFault {
    return {
      name: 'WasmlLlamaError',
      category: this.category,
      code: this.code,
      origin: this.origin,
      severity: this.severity,
      recoverable: this.recoverable,
      message: this.message,
      context: this.context,
    };
  }
}

export function createFault(details: FaultDetails): WasmlLlamaError {
  return new WasmlLlamaError(details);
}

export function normalizeFault(
  error: unknown,
  fallback: Omit<FaultDetails, 'message'> & { message?: string },
): WasmlLlamaError {
  if (error instanceof WasmlLlamaError) {
    return error;
  }
  if (error instanceof Error) {
    return new WasmlLlamaError({
      ...fallback,
      message: error.message || fallback.message || fallback.code,
      cause: error,
    });
  }
  return new WasmlLlamaError({
    ...fallback,
    message: fallback.message || fallback.code,
    cause: error,
  });
}
