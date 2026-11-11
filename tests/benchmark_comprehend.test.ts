import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  runAegisEvaluation,
  runComprehendEvaluation,
  generateBenchmarkReport,
} from '../scripts/benchmark_comprehend.js';

describe('Amazon Comprehend vs AegisLLM Evaluation Benchmark', () => {
  const benchmarkFile = path.resolve('tests/fixtures/synthetic_pii_benchmark.json');
  const dataset = JSON.parse(fs.readFileSync(benchmarkFile, 'utf-8'));

  it('loads valid synthetic benchmark fixture with 40 diverse prompts', () => {
    expect(dataset.samples).toHaveLength(40);
  });

  it('verifies AegisLLM local engine satisfies sub-1ms P50 latency requirement', () => {
    const aegisEval = runAegisEvaluation(dataset);
    expect(aegisEval.metrics.latencyP50Ms).toBeLessThan(1.0); // Under 1ms
    expect(aegisEval.metrics.latencyP95Ms).toBeLessThan(5.0); // Well under 5ms budget
  });

  it('demonstrates AegisLLM significantly outperforms cloud Comprehend in detection speed', () => {
    const aegisEval = runAegisEvaluation(dataset);
    const comprehendEval = runComprehendEvaluation(dataset);

    // AegisLLM is orders of magnitude faster (microsecond compute vs cloud WAN roundtrip)
    expect(aegisEval.metrics.latencyP50Ms).toBeLessThan(comprehendEval.latencyP50Ms / 50);
  });

  it('demonstrates AegisLLM captures developer credentials missed by generic cloud NLP', () => {
    const aegisEval = runAegisEvaluation(dataset);
    const comprehendEval = runComprehendEvaluation(dataset);

    // AegisLLM has significantly higher recall on developer credentials and structured tokens
    expect(aegisEval.metrics.recall).toBeGreaterThan(comprehendEval.recall);
  });

  it('generates a clean markdown benchmark report', () => {
    const aegisEval = runAegisEvaluation(dataset);
    const comprehendEval = runComprehendEvaluation(dataset);

    const report = generateBenchmarkReport(
      aegisEval.metrics,
      comprehendEval,
      dataset.samples.length
    );

    expect(report).toContain('# Quantitative Evaluation Benchmark: AegisLLM vs Amazon Comprehend');
    expect(report).toContain('P50 Latency');
    expect(report).toContain('100% On-Device');
  });
});

