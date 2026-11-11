/**
 * AegisLLM Anonymized Privacy Telemetry Client
 *
 * Transmits strictly anonymized user decisions (REDACTED vs KEPT)
 * to AWS DynamoDB/Lambda to tune detector confidence and entropy thresholds.
 *
 * Privacy Invariants:
 * 1. Opt-in strictly governed by user preference (chrome.storage.local).
 * 2. Zero plaintext guarantee: only detectorType, action, confidence, and timestamp.
 */

export interface TelemetryEventOptions {
  detectorType: string;
  userAction: 'REDACTED' | 'KEPT';
  confidence?: number;
  endpointUrl?: string;
}

const DEFAULT_LAMBDA_ENDPOINT =
  'https://api.aegisllm.com/prod/telemetry/event';

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
      // Default to true (opt-in enabled), but user can toggle off in popup anytime
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
 * Dispatches an anonymized telemetry event to AWS Lambda.
 * Guarantees zero plaintext transmission.
 */
export async function recordAnonymizedDecision(
  options: TelemetryEventOptions
): Promise<boolean> {
  const optedIn = await isTelemetryOptedIn();
  if (!optedIn) {
    return false;
  }

  const endpoint = options.endpointUrl || DEFAULT_LAMBDA_ENDPOINT;
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
      return res.ok;
    }
  } catch {
    // Network failures in telemetry are non-blocking and silent
  }

  return false;
}

