import type { FaultOrigin, FaultSeverity } from './errors.js';

export interface StructuredLogEvent {
  timestamp: string;
  origin: FaultOrigin;
  severity: FaultSeverity;
  code: string;
  message: string;
  requestId?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

export type EventSink = (event: StructuredLogEvent) => void;

export function createLogEvent(input: Omit<StructuredLogEvent, 'timestamp'>): StructuredLogEvent {
  return {
    ...input,
    timestamp: new Date().toISOString(),
  };
}
