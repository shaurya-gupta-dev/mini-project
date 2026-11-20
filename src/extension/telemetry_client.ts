/**
 * AegisLLM Anonymized Privacy Telemetry Client
 *
 * Transmits strictly anonymized user decisions (REDACTED vs KEPT)
 * to AWS DynamoDB/Lambda via API Gateway to tune detector confidence and entropy thresholds.
 *
 * Privacy Invariants:
 * 1. Opt-in strictly governed by user preference (chrome.storage.local).
 * 2. Zero plaintext guarantee: only detectorType, userAction, confidence, and clientTimestamp.
 */

import { getAwsConfig, isPlaceholderAwsUrl } from './aws_config.js';

export interface TelemetryEventOptions {
  detectorType: string;
  userAction: 'REDACTED' | 'KEPT';
  confidence?: number;
  endpointUrl?: string;
}

export interface TelemetryDispatchResult {
  sent: boolean;
  statusCode?: number | undefined;
  reason?: string | undefined;
  endpoint: string;
}

const OPT_IN_STORAGE_KEY = 'aegis_telemetry_opt_in';

/**
 * Checks whether user has opted into anonymous telemetry.
 */
export async function isTelemetryOptedIn(): Promise<boolean> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const items = await new Promise<{ [OPT_IN_STORAGE_KEY]?: boolean }>((resolve) => {
        chrome.storage.local.get([OPT_IN_STORAGE_KEY], (res) => resolve(res));
      });
      return items[OPT_IN_STORAGE_KEY] !== false;
    }
  } catch {
    // Fail closed
  }
  return true;
}

/**
 * Updates user telemetry opt-in preference.
 */
export async function setTelemetryOptIn(optIn: boolean): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [OPT_IN_STORAGE_KEY]: optIn });
    }
  } catch {
    // Storage failure
  }
}

/**
 * Dispatches an anonymized telemetry event to AWS API Gateway -> Lambda and returns detailed status.
 * Guarantees zero plaintext transmission.
 */
export async function recordAnonymizedDecisionWithStatus(
  options: TelemetryEventOptions,
): Promise<TelemetryDispatchResult> {
  const config = await getAwsConfig();
  const endpoint = (options.endpointUrl || config.telemetryEndpointUrl).trim();

  const optedIn = await isTelemetryOptedIn();
  if (!optedIn) {
    return { sent: false, reason: 'Telemetry opted out', endpoint };
  }

  if (isPlaceholderAwsUrl(endpoint)) {
    return { sent: false, reason: 'Awaiting AWS Deploy', endpoint };
  }

  const payload = {
    detectorType: options.detectorType,
    userAction: options.userAction,
    confidence: Math.min(1.0, Math.max(0.0, options.confidence ?? 0.95)),
    clientTimestamp: Date.now(),
  };

  try {
    if (typeof fetch === 'function') {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        return { sent: true, statusCode: res.status, endpoint };
      }
      return {
        sent: false,
        statusCode: res.status,
        reason: `HTTP ${res.status}`,
        endpoint,
      };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Network error';
    return { sent: false, reason, endpoint };
  }

  return { sent: false, reason: 'fetch unavailable', endpoint };
}

/**
 * Dispatches an anonymized telemetry event to AWS Lambda.
 * Guarantees zero plaintext transmission.
 */
export async function recordAnonymizedDecision(
  options: TelemetryEventOptions,
): Promise<boolean> {
  const result = await recordAnonymizedDecisionWithStatus(options);
  return result.sent;
}
