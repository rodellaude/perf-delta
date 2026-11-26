/**
 * Canonical Telemetry & SLA TypeScript Contracts (`dashboard-ui/src/types/performance.ts`)
 *
 * Shared shape between `dashboard-api/server.js` (`/api/runs`) and all React views.
 */
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
  errorCount?: number;
  errorRate: number;
  phase: LoadPhase;
}

export interface EndpointMetric {
  endpoint: string;
  appName?: string;
  scenario?: string;
  samples: number;
  avg: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  throughput: number;
  errorPct: number;
  slaP95Ms: number;
  rtBreached?: boolean;
  errorBreached?: boolean;
}

export interface AppHealthMetric {
  appName: string;
  samples: number;
  peakVUs: number;
  throughput: number;
  avg: number;
  p90: number;
  p95: number;
  p99: number;
  errors: number;
  errorPct: number;
  apdexScore?: number;
  apdexRating?: string;
}

export interface ScenarioMetric {
  appName: string;
  scenario: string;
  samples: number;
  throughput: number;
  avg: number;
  p90: number;
  p95: number;
  p99: number;
  errors: number;
  errorPct: number;
  passedLabels: number;
  totalLabels: number;
}

export interface ApdexSummary {
  score: number;
  rating: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Unacceptable' | string;
  satisfied: number;
  tolerating: number;
  frustrated: number;
  total: number;
  satisfiedPct: number;
  toleratingPct: number;
  frustratedPct: number;
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

export interface ErrorDetailRow {
  appName: string;
  scenario: string;
  endpoint: string;
  url: string;
  responseCode: string;
  responseMessage: string;
  failureMessage: string;
  count: number;
}

export interface TestRunSummary {
  peakVUs: number;
  avgThroughputRps: number;
  p90ResponseTimeMs?: number;
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
    rtEnabled?: boolean;
    rtMetric?: 'p90' | 'p95';
    tolerancePct?: number;
    errorEnabled?: boolean;
    tpsEnabled?: boolean;
    tpsTarget?: number;
    vuEnabled?: boolean;
    vuTarget?: number;
    showOverallStatus?: boolean;
  };
  summary: TestRunSummary;
  apdex?: ApdexSummary;
  apps?: AppHealthMetric[];
  scenarios?: ScenarioMetric[];
  timeSeries: TelemetryPoint[];
  endpoints: EndpointMetric[];
  httpErrors: HttpErrorGroup[];
  assertionFailures: AssertionFailure[];
  errorDetails?: ErrorDetailRow[];
}

export interface VaultExportPayload {
  generatedAt: string;
  vaultPath: string;
  runs: PerformanceTestRun[];
}
