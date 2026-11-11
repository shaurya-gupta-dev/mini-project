import { describe, it, expect, beforeEach } from 'vitest';
import { TelemetryStore, categorizeEntity } from '../src/extension/telemetry_store.js';

describe('Telemetry & Analytics Store', () => {
  let store: TelemetryStore;

  beforeEach(() => {
    store = new TelemetryStore();
  });

  it('categorizes entity types accurately', () => {
    expect(categorizeEntity('OPENAI_API_KEY')).toBe('API_KEY');
    expect(categorizeEntity('AWS_ACCESS_KEY')).toBe('API_KEY');
    expect(categorizeEntity('CREDIT_CARD')).toBe('CARD');
    expect(categorizeEntity('EMAIL')).toBe('PII');
    expect(categorizeEntity('PHONE_NUMBER')).toBe('PII');
    expect(categorizeEntity('SSN')).toBe('PII');
    expect(categorizeEntity('HIGH_ENTROPY_SECRET')).toBe('ENTROPY');
  });

  it('increments cumulative metrics and categorizes blocked secrets', async () => {
    await store.recordInterception('ChatGPT', ['OPENAI_API_KEY', 'EMAIL']);
    await store.recordInterception('Claude', ['CREDIT_CARD', 'HIGH_ENTROPY_SECRET', 'AWS_ACCESS_KEY']);

    const metrics = await store.getMetrics();
    expect(metrics.totalPromptsGuarded).toBe(2);
    expect(metrics.totalSecretsBlocked).toBe(5);

    expect(metrics.apiKeysBlocked).toBe(2); // OPENAI_API_KEY + AWS_ACCESS_KEY
    expect(metrics.cardsBlocked).toBe(1); // CREDIT_CARD
    expect(metrics.piiBlocked).toBe(1); // EMAIL
    expect(metrics.entropyBlocked).toBe(1); // HIGH_ENTROPY_SECRET
  });

  it('records recent events with platform and counts without raw text leakage', async () => {
    await store.recordInterception('Google Gemini', ['GITHUB_TOKEN', 'GITHUB_TOKEN']);

    const metrics = await store.getMetrics();
    expect(metrics.recentEvents.length).toBe(1);

    const evt = metrics.recentEvents[0]!;
    expect(evt.platform).toBe('Google Gemini');
    expect(evt.totalBlocked).toBe(2);
    expect(evt.countsByType['GITHUB_TOKEN']).toBe(2);

    // INVARIANT: event record must contain NO raw credentials or keys
    expect(JSON.stringify(evt)).not.toContain('ghp_');
  });

  it('resets all metrics cleanly', async () => {
    await store.recordInterception('ChatGPT', ['OPENAI_API_KEY']);
    await store.resetMetrics();

    const metrics = await store.getMetrics();
    expect(metrics.totalPromptsGuarded).toBe(0);
    expect(metrics.totalSecretsBlocked).toBe(0);
    expect(metrics.recentEvents.length).toBe(0);
  });

  it('caps recent interception history at 30 items to bound memory', async () => {
    for (let i = 0; i < 35; i++) {
      await store.recordInterception(`Platform_${i}`, ['EMAIL']);
    }

    const metrics = await store.getMetrics();
    expect(metrics.recentEvents.length).toBe(30);
    expect(metrics.totalPromptsGuarded).toBe(35);
  });
});

