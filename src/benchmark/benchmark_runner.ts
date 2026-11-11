/**
 * AegisLLM Quantitative Benchmark Suite
 * Measures Precision, Recall, F1-Score, Latency Distribution (p50/p95/p99),
 * and Memory Footprint on commodity hardware.
 */

import { redactText } from '../engine/detector_pipeline.js';
import { EntityType } from '../engine/types.js';

export interface BenchmarkTestCase {
  text: string;
  expectedTypes: EntityType[];
  description: string;
}

export interface LatencyDistribution {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  iterations: number;
}

export interface MetricSummary {
  totalSamples: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  latency: LatencyDistribution;
  memoryDeltaMb: number;
}

// Representative test dataset including positive credentials and negative controls
export const BENCHMARK_DATASET: BenchmarkTestCase[] = [
  // --- Positives: Cloud & API Credentials ---
  {
    text: 'export OPENAI_API_KEY="sk-proj-a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2w3X4y5Z6"',
    expectedTypes: ['OPENAI_API_KEY'],
    description: 'OpenAI Project API Key',
  },
  {
    text: 'ANTHROPIC_KEY=sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890',
    expectedTypes: ['ANTHROPIC_API_KEY'],
    description: 'Anthropic Claude API Key',
  },
  {
    text: 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
    expectedTypes: ['AWS_ACCESS_KEY'],
    description: 'AWS Access Key ID',
  },
  {
    text: 'git remote set-url origin https://ghp_11223344556677889900aabbccddeeff1234@github.com/repo',
    expectedTypes: ['GITHUB_TOKEN'],
    description: 'GitHub Personal Access Token',
  },
  {
    text: 'const GEMINI_API_KEY = "AIzaSyD-1234567890abcdefghijklmnopqrstuv"',
    expectedTypes: ['GOOGLE_API_KEY'],
    description: 'Google Gemini API Key',
  },
  {
    text: 'SLACK_BOT_TOKEN="xoxb-123456789012-1234567890123-456789abcdef1234567890ab"',
    expectedTypes: ['SLACK_TOKEN'],
    description: 'Slack Bot Token',
  },

  // --- Positives: Financial & PII ---
  {
    text: 'Charge card 4532 0151 1283 0366 for the transaction.',
    expectedTypes: ['CREDIT_CARD'],
    description: 'Visa Credit Card with spaces',
  },
  {
    text: 'Billing card: 5424-1801-2345-6789.',
    expectedTypes: ['CREDIT_CARD'],
    description: 'Mastercard with dashes',
  },
  {
    text: 'Send verification to developer.student@university.edu today.',
    expectedTypes: ['EMAIL'],
    description: 'Academic email address',
  },
  {
    text: 'Emergency direct line: (555) 867-5309.',
    expectedTypes: ['PHONE_NUMBER'],
    description: 'US Phone number',
  },
  {
    text: 'Customer SSN on file is 123-45-6789.',
    expectedTypes: ['SSN'],
    description: 'US Social Security Number',
  },
  {
    text: 'Connecting to database server at 192.168.1.55 on port 5432.',
    expectedTypes: ['IPV4'],
    description: 'Private IPv4 address',
  },

  // --- Positives: High-Entropy Secrets ---
  {
    text: 'const jwtSecret = "K9#xP2$mQ8!vL4@wZ7&rT1*bN5^yC3%u";',
    expectedTypes: ['HIGH_ENTROPY_SECRET'],
    description: 'High-entropy cryptographic secret',
  },

  // --- Negative Controls (Zero-PII text to test false-positive rates) ---
  {
    text: 'The quick brown fox jumps over the lazy dog.',
    expectedTypes: [],
    description: 'Pangram English sentence',
  },
  {
    text: 'function calculateArea(width: number, height: number): number { return width * height; }',
    expectedTypes: [],
    description: 'Clean TypeScript function without secrets',
  },
  {
    text: 'const orderId = "1234567812345678"; // arbitrary 16-digit number that fails Luhn',
    expectedTypes: [],
    description: '16-digit order ID failing Luhn (Negative Credit Card check)',
  },
  {
    text: 'const sessionUUID = "550e8400-e29b-41d4-a716-446655440000";',
    expectedTypes: [],
    description: 'Standard UUID (Negative Entropy check)',
  },
  {
    text: 'git commit -m "chore: update dependencies" (SHA: 4a3f2b1c8e9d0a7b6c5d4e3f2a1b0c9d8e7f6a5b)',
    expectedTypes: [],
    description: 'Git 40-char SHA commit (Negative check)',
  },
  {
    text: 'Bind to default listen address 0.0.0.0 on port 8080.',
    expectedTypes: [],
    description: 'Default zero IP 0.0.0.0 (Negative IP check)',
  },
];

/**
 * Executes statistical evaluation across the dataset.
 */
export function evaluatePrecisionAndRecall(
  dataset: BenchmarkTestCase[] = BENCHMARK_DATASET
): Omit<MetricSummary, 'latency' | 'memoryDeltaMb'> {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;

  for (const sample of dataset) {
    const result = redactText(sample.text);
    const detectedTypes = result.entities.map((e) => e.type);

    if (sample.expectedTypes.length === 0) {
      if (detectedTypes.length === 0) {
        trueNegatives++;
      } else {
        console.log(`[FP on "${sample.description}"]:`, detectedTypes, result.entities.map(e => e.raw));
        falsePositives += detectedTypes.length;
      }
    } else {
      for (const expected of sample.expectedTypes) {
        if (detectedTypes.includes(expected)) {
          truePositives++;
        } else {
          falseNegatives++;
        }
      }

      // Check for any unprompted false positives in positive samples
      for (const detected of detectedTypes) {
        if (!sample.expectedTypes.includes(detected)) {
          falsePositives++;
        }
      }
    }
  }

  const precision =
    truePositives + falsePositives === 0
      ? 1.0
      : truePositives / (truePositives + falsePositives);

  const recall =
    truePositives + falseNegatives === 0
      ? 1.0
      : truePositives / (truePositives + falseNegatives);

  const f1Score =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    totalSamples: dataset.length,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1Score: Number(f1Score.toFixed(4)),
  };
}

/**
 * Measures high-resolution latency distribution (p50, p95, p99) over N iterations.
 */
export function measureLatencyDistribution(
  sampleText?: string,
  iterations: number = 500
): LatencyDistribution {
  const text =
    sampleText ||
    `
    // Sample developer prompt containing code, logs, and sensitive data
    const OPENAI_KEY = "sk-proj-abcdef1234567890abcdef1234567890abcdef1234567890";
    const userEmail = "researcher.lead@ai-lab.org";
    const billingCard = "4532 0151 1283 0366";
    const internalHost = "10.0.12.44";
    const secretJwt = "W8#eR2*tY5^uI8(oP1_aS4+dF7-gH0$jK3";
    console.log("Config loaded for user verification.");
  `.repeat(4); // ~1,000 characters

  const timings: number[] = [];

  // Warmup run
  for (let i = 0; i < 20; i++) {
    redactText(text);
  }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    redactText(text);
    const elapsed = performance.now() - start;
    timings.push(elapsed);
  }

  timings.sort((a, b) => a - b);

  const p50 = timings[Math.floor(iterations * 0.5)]!;
  const p95 = timings[Math.floor(iterations * 0.95)]!;
  const p99 = timings[Math.floor(iterations * 0.99)]!;
  const min = timings[0]!;
  const max = timings[timings.length - 1]!;
  const sum = timings.reduce((acc, t) => acc + t, 0);
  const mean = sum / iterations;

  return {
    p50Ms: Number(p50.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
    p99Ms: Number(p99.toFixed(3)),
    meanMs: Number(mean.toFixed(3)),
    minMs: Number(min.toFixed(3)),
    maxMs: Number(max.toFixed(3)),
    iterations,
  };
}

/**
 * Runs full benchmark and returns complete metric report.
 */
export function runCompleteBenchmark(): MetricSummary {
  const memBefore = process.memoryUsage().heapUsed;

  const evalMetrics = evaluatePrecisionAndRecall();
  const latency = measureLatencyDistribution(undefined, 500);

  const memAfter = process.memoryUsage().heapUsed;
  const memoryDeltaMb = Number(
    ((memAfter - memBefore) / (1024 * 1024)).toFixed(3)
  );

  return {
    ...evalMetrics,
    latency,
    memoryDeltaMb,
  };
}
