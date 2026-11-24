export type TimeRangeOption = '15m' | '1h' | 'full';
export type LoadPhase = 'ramp-up' | 'steady' | 'spike' | 'ramp-down';

export interface TelemetryPoint {
  timestamp: string;
  isoTimestamp: string;
  epochMs: number;
  vus: number;
  throughput: number;
  avg: number;
  p90: number;
  p95: number;
  p99: number;
  errorRate: number;
  phase: LoadPhase;
}

export interface EndpointMetric {
  endpoint: string;
  samples: number;
  avg: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  throughput: number;
  errorPct: number;
  slaP95Ms: number;
}

export interface HttpErrorGroup {
  code: string;
  label: string;
  count: number;
  percentage: number;
}

export interface AssertionFailure {
  id: string;
  assertion: string;
  endpoint: string;
  count: number;
  severity: 'critical' | 'warning';
}

export interface TestRunSummary {
  peakVUs: number;
  avgThroughputRps: number;
  p95ResponseTimeMs: number;
  errorRatePct: number;
  totalRequests: number;
  failedRequests: number;
}

export interface PerformanceTestRun {
  id: string;
  name: string;
  source: 'mock' | 'duckdb-vault';
  tool?: string;
  environment: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  sla: {
    p95Ms: number;
    errorRatePct: number;
  };
  summary: TestRunSummary;
  timeSeries: TelemetryPoint[];
  endpoints: EndpointMetric[];
  httpErrors: HttpErrorGroup[];
  assertionFailures: AssertionFailure[];
}

export interface VaultExportPayload {
  generatedAt: string;
  vaultPath: string;
  runs: PerformanceTestRun[];
}
