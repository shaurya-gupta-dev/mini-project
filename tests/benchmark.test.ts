import { describe, it, expect } from 'vitest';
import { runCompleteBenchmark } from '../src/benchmark/benchmark_runner.js';

describe('AegisLLM Quantitative Empirical Benchmark', () => {
  const summary = runCompleteBenchmark();

  it('achieves >= 95% Precision on the benchmark suite', () => {
    console.log(`[Benchmark] Precision: ${(summary.precision * 100).toFixed(2)}%`);
    expect(summary.precision).toBeGreaterThanOrEqual(0.95);
  });

  it('achieves >= 95% Recall across diverse PII and secrets', () => {
    console.log(`[Benchmark] Recall: ${(summary.recall * 100).toFixed(2)}%`);
    expect(summary.recall).toBeGreaterThanOrEqual(0.95);
  });

  it('achieves >= 95% F1-Score', () => {
    console.log(`[Benchmark] F1 Score: ${(summary.f1Score * 100).toFixed(2)}%`);
    expect(summary.f1Score).toBeGreaterThanOrEqual(0.95);
  });

  it('satisfies sub-5ms P50 latency budget on laptop hardware', () => {
    console.log(
      `[Benchmark] Latency: p50=${summary.latency.p50Ms}ms, p95=${summary.latency.p95Ms}ms, p99=${summary.latency.p99Ms}ms (500 runs)`
    );
    expect(summary.latency.p50Ms).toBeLessThanOrEqual(5.0);
    expect(summary.latency.p95Ms).toBeLessThanOrEqual(10.0);
  });

  it('maintains zero false positives on negative control prompts', () => {
    console.log('[Benchmark False Positives Count]:', summary.falsePositives);
    expect(summary.falsePositives).toBe(0);
  });
});
