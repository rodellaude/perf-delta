/**
 * Built-in Simulated Stress Telemetry (`dashboard-ui/src/data/mockPerformanceData.ts`)
 *
 * Provides deterministic demo runs when `Data/Performance_Vault.db` has no registered runs yet,
 * and allows previewing the Cyber-Slate UI offline without a live backend.
 */
import { LoadPhase, PerformanceTestRun, TelemetryPoint } from '../types/performance';

function seededNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Generates realistic multi-phase telemetry:
 * Ramp-Up (0-18%), Steady-State (18-62%), Spike (62-80%), Ramp-Down (80-100%).
 */
function generateStressSeries(options: {
  startIso: string;
  points: number;
  stepSeconds: number;
  steadyVus: number;
  spikeVus: number;
  baseRpsPerVu: number;
  baseLatencyMs: number;
  spikeLatencyMultiplier: number;
  seedOffset: number;
}): TelemetryPoint[] {
  const startMs = Date.parse(options.startIso);
  const series: TelemetryPoint[] = [];

  for (let i = 0; i < options.points; i++) {
    const progress = i / (options.points - 1);
    const n1 = seededNoise(i + options.seedOffset);
    const n2 = seededNoise(i * 1.7 + options.seedOffset + 31);
    const n3 = seededNoise(i * 2.3 + options.seedOffset + 97);

    let phase: LoadPhase = 'steady';
    let vus = options.steadyVus;
    let latencyFactor = 1.0;
    let errRate = 0.12 + n3 * 0.15;

    if (progress < 0.18) {
      phase = 'ramp-up';
      const t = progress / 0.18;
      vus = Math.max(25, Math.round(options.steadyVus * Math.pow(t, 0.92)));
      latencyFactor = 0.72 + t * 0.28;
      errRate = 0.04 + n3 * 0.08;
    } else if (progress < 0.62) {
      phase = 'steady';
      vus = Math.round(options.steadyVus + (n1 - 0.5) * (options.steadyVus * 0.04));
      latencyFactor = 1.0 + (n2 - 0.5) * 0.12;
      errRate = 0.18 + n3 * 0.22;
    } else if (progress < 0.8) {
      phase = 'spike';
      const t = (progress - 0.62) / 0.18;
      const bell = Math.sin(t * Math.PI);
      vus = Math.round(options.steadyVus + (options.spikeVus - options.steadyVus) * bell);
      latencyFactor = 1.0 + (options.spikeLatencyMultiplier - 1.0) * Math.pow(bell, 0.85) + (n2 - 0.5) * 0.18;
      errRate = 0.45 + bell * 3.85 + n3 * 0.65;
    } else {
      phase = 'ramp-down';
      const t = (progress - 0.8) / 0.2;
      vus = Math.max(15, Math.round(options.steadyVus * (1 - t * 0.92)));
      latencyFactor = 0.8 + (1 - t) * 0.35;
      errRate = Math.max(0.05, (1 - t) * 0.55 + n3 * 0.1);
    }

    // Throughput saturates slightly under heavy spike contention
    const saturationPenalty = phase === 'spike' ? 0.86 : 1.0;
    const throughput = Number(
      (vus * options.baseRpsPerVu * saturationPenalty * (0.95 + n1 * 0.1)).toFixed(1)
    );

    const avg = Number((options.baseLatencyMs * latencyFactor * (0.94 + n2 * 0.12)).toFixed(0));
    const p90 = Number((avg * (1.58 + n1 * 0.14)).toFixed(0));
    const p95 = Number((avg * (1.92 + n2 * 0.18)).toFixed(0));
    const p99 = Number((avg * (2.68 + n3 * 0.28)).toFixed(0));

    const epochMs = startMs + i * options.stepSeconds * 1000;
    const d = new Date(epochMs);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');

    series.push({
      timestamp: `${hh}:${mm}:${ss}`,
      isoTimestamp: d.toISOString(),
      epochMs,
      vus,
      throughput,
      avg,
      p90,
      p95,
      p99,
      errorRate: Number(errRate.toFixed(2)),
      phase,
    });
  }

  return series;
}

const checkoutSeries = generateStressSeries({
  startIso: '2026-11-24T00:00:00Z',
  points: 72,
  stepSeconds: 50,
  steadyVus: 650,
  spikeVus: 1450,
  baseRpsPerVu: 1.48,
  baseLatencyMs: 148,
  spikeLatencyMultiplier: 2.35,
  seedOffset: 7,
});

const paymentSoakSeries = generateStressSeries({
  startIso: '2026-11-23T22:00:00Z',
  points: 60,
  stepSeconds: 60,
  steadyVus: 420,
  spikeVus: 560,
  baseRpsPerVu: 1.72,
  baseLatencyMs: 96,
  spikeLatencyMultiplier: 1.38,
  seedOffset: 41,
});

export const MOCK_TEST_RUNS: PerformanceTestRun[] = [
  {
    id: 'mock-checkout-stress-42',
    name: 'Checkout API - Stress Test #42',
    source: 'mock',
    tool: 'k6 / JMeter',
    environment: 'STAGING',
    startedAt: '2026-11-24T00:00:00Z',
    endedAt: '2026-11-24T01:00:00Z',
    durationMinutes: 60,
    sla: {
      p95Ms: 500,
      errorRatePct: 1.0,
    },
    summary: {
      peakVUs: 1450,
      avgThroughputRps: 984.6,
      p95ResponseTimeMs: 542,
      errorRatePct: 1.48,
      totalRequests: 3544560,
      failedRequests: 52459,
    },
    timeSeries: checkoutSeries,
    endpoints: [
      {
        endpoint: 'POST /api/v2/checkout/confirm',
        samples: 412840,
        avg: 284,
        p90: 492,
        p95: 684,
        p99: 1240,
        max: 4820,
        throughput: 114.7,
        errorPct: 2.84,
        slaP95Ms: 500,
      },
      {
        endpoint: 'POST /api/v2/payments/authorize',
        samples: 408120,
        avg: 312,
        p90: 540,
        p95: 748,
        p99: 1580,
        max: 5210,
        throughput: 113.4,
        errorPct: 3.12,
        slaP95Ms: 500,
      },
      {
        endpoint: 'GET /api/v2/cart/summary',
        samples: 694200,
        avg: 82,
        p90: 138,
        p95: 174,
        p99: 290,
        max: 910,
        throughput: 192.8,
        errorPct: 0.14,
        slaP95Ms: 500,
      },
      {
        endpoint: 'POST /api/v2/inventory/reserve',
        samples: 438900,
        avg: 226,
        p90: 410,
        p95: 538,
        p99: 990,
        max: 3420,
        throughput: 121.9,
        errorPct: 1.65,
        slaP95Ms: 500,
      },
      {
        endpoint: 'GET /api/v2/catalog/products/:id',
        samples: 812400,
        avg: 48,
        p90: 84,
        p95: 112,
        p99: 195,
        max: 640,
        throughput: 225.7,
        errorPct: 0.06,
        slaP95Ms: 500,
      },
      {
        endpoint: 'POST /api/v2/shipping/quote',
        samples: 364500,
        avg: 194,
        p90: 342,
        p95: 468,
        p99: 845,
        max: 2790,
        throughput: 101.3,
        errorPct: 0.82,
        slaP95Ms: 500,
      },
      {
        endpoint: 'POST /api/v2/promo/validate',
        samples: 228600,
        avg: 118,
        p90: 196,
        p95: 254,
        p99: 430,
        max: 1180,
        throughput: 63.5,
        errorPct: 0.21,
        slaP95Ms: 500,
      },
      {
        endpoint: 'GET /api/v2/auth/session',
        samples: 185000,
        avg: 34,
        p90: 58,
        p95: 76,
        p99: 142,
        max: 490,
        throughput: 51.4,
        errorPct: 0.02,
        slaP95Ms: 500,
      },
    ],
    httpErrors: [
      { code: '504', label: 'Gateway Timeout', count: 24180, percentage: 46.1 },
      { code: '502', label: 'Bad Gateway', count: 14820, percentage: 28.3 },
      { code: '503', label: 'Service Unavailable', count: 8412, percentage: 16.0 },
      { code: '429', label: 'Too Many Requests', count: 3890, percentage: 7.4 },
      { code: '500', label: 'Internal Server Error', count: 1157, percentage: 2.2 },
    ],
    assertionFailures: [
      {
        id: 'af-1',
        assertion: 'p95(http_req_duration) < 500ms breached during spike phase (748ms)',
        endpoint: 'POST /api/v2/payments/authorize',
        count: 14820,
        severity: 'critical',
      },
      {
        id: 'af-2',
        assertion: 'JSONPath $.orderId exists — upstream timeout returned empty body',
        endpoint: 'POST /api/v2/checkout/confirm',
        count: 11940,
        severity: 'critical',
      },
      {
        id: 'af-3',
        assertion: 'HTTP status expected 200/201, received 504 Gateway Timeout',
        endpoint: 'POST /api/v2/inventory/reserve',
        count: 7214,
        severity: 'critical',
      },
      {
        id: 'af-4',
        assertion: 'Rate-limit header X-RateLimit-Remaining > 0',
        endpoint: 'POST /api/v2/shipping/quote',
        count: 2985,
        severity: 'warning',
      },
    ],
  },
  {
    id: 'mock-payment-soak-18',
    name: 'Payment Gateway - Soak Test #18',
    source: 'mock',
    tool: 'k6 / JMeter',
    environment: 'PRE-PROD',
    startedAt: '2026-11-23T22:00:00Z',
    endedAt: '2026-11-23T23:00:00Z',
    durationMinutes: 60,
    sla: {
      p95Ms: 400,
      errorRatePct: 0.5,
    },
    summary: {
      peakVUs: 560,
      avgThroughputRps: 718.4,
      p95ResponseTimeMs: 248,
      errorRatePct: 0.19,
      totalRequests: 2586240,
      failedRequests: 4914,
    },
    timeSeries: paymentSoakSeries,
    endpoints: [
      {
        endpoint: 'POST /api/v2/payments/tokenize',
        samples: 742100,
        avg: 94,
        p90: 152,
        p95: 198,
        p99: 312,
        max: 840,
        throughput: 206.1,
        errorPct: 0.12,
        slaP95Ms: 400,
      },
      {
        endpoint: 'POST /api/v2/payments/capture',
        samples: 698400,
        avg: 128,
        p90: 214,
        p95: 274,
        p99: 448,
        max: 1120,
        throughput: 194.0,
        errorPct: 0.28,
        slaP95Ms: 400,
      },
      {
        endpoint: 'GET /api/v2/payments/status/:txId',
        samples: 641240,
        avg: 52,
        p90: 88,
        p95: 118,
        p99: 190,
        max: 520,
        throughput: 178.1,
        errorPct: 0.05,
        slaP95Ms: 400,
      },
      {
        endpoint: 'POST /api/v2/fraud/score',
        samples: 504500,
        avg: 146,
        p90: 242,
        p95: 318,
        p99: 520,
        max: 1410,
        throughput: 140.1,
        errorPct: 0.31,
        slaP95Ms: 400,
      },
    ],
    httpErrors: [
      { code: '502', label: 'Bad Gateway', count: 2410, percentage: 49.0 },
      { code: '504', label: 'Gateway Timeout', count: 1620, percentage: 33.0 },
      { code: '429', label: 'Too Many Requests', count: 884, percentage: 18.0 },
    ],
    assertionFailures: [
      {
        id: 'pf-1',
        assertion: 'Upstream fraud-engine SLA soft warning (> 300ms)',
        endpoint: 'POST /api/v2/fraud/score',
        count: 1560,
        severity: 'warning',
      },
      {
        id: 'pf-2',
        assertion: 'Transient connection reset during TLS keep-alive recycle',
        endpoint: 'POST /api/v2/payments/capture',
        count: 842,
        severity: 'warning',
      },
    ],
  },
];
