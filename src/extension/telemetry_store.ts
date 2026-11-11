/**
 * Privacy-Preserving Telemetry & Audit Store
 * Tracks cumulative statistics, categorical breakdowns, and recent interception events.
 * INVARIANT: Never stores raw sensitive text to persistent storage; logs only counts and types.
 */

import { EntityType } from '../engine/types.js';

export interface InterceptionEvent {
  id: string;
  timestamp: number;
  platform: string;
  totalBlocked: number;
  countsByType: Record<string, number>;
}

export interface TelemetryMetrics {
  totalPromptsGuarded: number;
  totalSecretsBlocked: number;
  apiKeysBlocked: number;
  cardsBlocked: number;
  piiBlocked: number;
  entropyBlocked: number;
  privateKeysBlocked?: number;
  dbUrlsBlocked?: number;
  recentEvents: InterceptionEvent[];
}

export function categorizeEntity(type: EntityType): 'API_KEY' | 'CARD' | 'PII' | 'ENTROPY' {
  switch (type) {
    case 'OPENAI_API_KEY':
    case 'ANTHROPIC_API_KEY':
    case 'AWS_ACCESS_KEY':
    case 'AWS_SECRET_KEY':
    case 'GITHUB_TOKEN':
    case 'GOOGLE_API_KEY':
    case 'SLACK_TOKEN':
    case 'GENERIC_API_KEY':
    case 'HUGGINGFACE_TOKEN':
    case 'GITLAB_TOKEN':
    case 'STRIPE_KEY':
    case 'DATABASE_URL':
    case 'PRIVATE_KEY':
    case 'JWT_TOKEN':
    case 'PASSWORD':
      return 'API_KEY';
    case 'CREDIT_CARD':
      return 'CARD';
    case 'EMAIL':
    case 'PHONE_NUMBER':
    case 'IPV4':
    case 'IPV6':
    case 'SSN':
      return 'PII';
    case 'HIGH_ENTROPY_SECRET':
      return 'ENTROPY';
  }
}

const STORAGE_KEY = 'aegis_telemetry_metrics';

const INITIAL_METRICS: TelemetryMetrics = {
  totalPromptsGuarded: 0,
  totalSecretsBlocked: 0,
  apiKeysBlocked: 0,
  cardsBlocked: 0,
  piiBlocked: 0,
  entropyBlocked: 0,
  recentEvents: [],
};

export class TelemetryStore {
  private inMemoryMetrics: TelemetryMetrics = { ...INITIAL_METRICS, recentEvents: [] };

  /**
   * Loads metrics from persistent storage or returns in-memory state.
   */
  public async getMetrics(): Promise<TelemetryMetrics> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data && data[STORAGE_KEY]) {
          this.inMemoryMetrics = data[STORAGE_KEY] as TelemetryMetrics;
        }
      } catch {
        // Fallback to in-memory
      }
    }
    return { ...this.inMemoryMetrics, recentEvents: [...this.inMemoryMetrics.recentEvents] };
  }

  /**
   * Records an interception event with categorized increments.
   */
  public async recordInterception(
    platform: string,
    entityTypes: EntityType[]
  ): Promise<TelemetryMetrics> {
    const metrics = await this.getMetrics();

    if (entityTypes.length === 0) {
      return metrics;
    }

    metrics.totalPromptsGuarded += 1;
    metrics.totalSecretsBlocked += entityTypes.length;

    const countsByType: Record<string, number> = {};

    for (const type of entityTypes) {
      countsByType[type] = (countsByType[type] ?? 0) + 1;
      const category = categorizeEntity(type);

      if (type === 'PRIVATE_KEY') {
        metrics.privateKeysBlocked = (metrics.privateKeysBlocked || 0) + 1;
      }
      if (type === 'DATABASE_URL') {
        metrics.dbUrlsBlocked = (metrics.dbUrlsBlocked || 0) + 1;
      }

      if (category === 'API_KEY') metrics.apiKeysBlocked++;
      else if (category === 'CARD') metrics.cardsBlocked++;
      else if (category === 'PII') metrics.piiBlocked++;
      else if (category === 'ENTROPY') metrics.entropyBlocked++;
    }

    const event: InterceptionEvent = {
      id: 'evt_' + Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      platform,
      totalBlocked: entityTypes.length,
      countsByType,
    };

    // Prepend and cap at 30 recent events
    metrics.recentEvents = [event, ...metrics.recentEvents].slice(0, 30);
    this.inMemoryMetrics = metrics;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: metrics });
      } catch {
        // Storage write ignored in mock/test
      }
    }

    return metrics;
  }

  /**
   * Resets all metrics and audit logs.
   */
  public async resetMetrics(): Promise<void> {
    this.inMemoryMetrics = { ...INITIAL_METRICS, recentEvents: [] };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.remove(STORAGE_KEY);
      } catch {
        // Storage remove ignored in mock/test
      }
    }
  }
}

export const defaultTelemetryStore = new TelemetryStore();

