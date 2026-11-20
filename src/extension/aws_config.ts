/**
 * Shared AWS endpoint configuration and live synchronization state for AegisLLM.
 * Stores user/deploy-configured S3 signed rule pack URLs and API Gateway telemetry URLs
 * in chrome.storage.local, while preserving bundled fallbacks when offline or unconfigured.
 */

export interface AwsEndpointsConfig {
  s3RulesUrl: string;
  s3SignatureUrl: string;
  telemetryEndpointUrl: string;
}

export interface AwsSyncStatus {
  rulesSource: 's3' | 'cache' | 'bundled';
  rulesVersion: string;
  rulesCount: number;
  signatureVerified: boolean;
  lastRuleSyncAt: number | null;
  lastRuleError: string | null;
  telemetryConfigured: boolean;
  lastTelemetryStatus: string;
  lastTelemetryAt: number | null;
  totalCloudEventsSent: number;
}

export const AWS_CONFIG_STORAGE_KEY = 'aegis_aws_config';
export const AWS_STATUS_STORAGE_KEY = 'aegis_aws_sync_status';

export const PLACEHOLDER_S3_RULES_URL =
  'https://aegis-llm-rules.s3.amazonaws.com/rule_packs/rules.v1.json';
export const PLACEHOLDER_S3_SIG_URL =
  'https://aegis-llm-rules.s3.amazonaws.com/rule_packs/rules.v1.json.sig';
export const PLACEHOLDER_TELEMETRY_URL =
  'https://api.aegisllm.com/prod/telemetry/event';

export const DEFAULT_AWS_CONFIG: AwsEndpointsConfig = {
  s3RulesUrl: PLACEHOLDER_S3_RULES_URL,
  s3SignatureUrl: PLACEHOLDER_S3_SIG_URL,
  telemetryEndpointUrl: PLACEHOLDER_TELEMETRY_URL,
};

export const DEFAULT_AWS_SYNC_STATUS: AwsSyncStatus = {
  rulesSource: 'bundled',
  rulesVersion: '1.0.0-bundled',
  rulesCount: 5,
  signatureVerified: false,
  lastRuleSyncAt: null,
  lastRuleError: null,
  telemetryConfigured: false,
  lastTelemetryStatus: 'Awaiting AWS Deploy',
  lastTelemetryAt: null,
  totalCloudEventsSent: 0,
};

/**
 * Returns true if the URL is empty or matches an un-deployed placeholder domain.
 */
export function isPlaceholderAwsUrl(url: string | undefined | null): boolean {
  if (!url || !url.trim()) {
    return true;
  }
  const normalized = url.trim().toLowerCase();
  return (
    normalized.includes('api.aegisllm.com') ||
    normalized.includes('aegis-llm-rules.s3.amazonaws.com')
  );
}

/**
 * Retrieves the active AWS endpoint configuration from chrome.storage.local merged over defaults.
 */
export async function getAwsConfig(): Promise<AwsEndpointsConfig> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.local.get([AWS_CONFIG_STORAGE_KEY], (items) => resolve(items || {}));
      });
      const rawCfg = stored[AWS_CONFIG_STORAGE_KEY];
      if (rawCfg && typeof rawCfg === 'object') {
        const cfg = rawCfg as Partial<AwsEndpointsConfig>;
        const s3RulesUrl =
          typeof cfg.s3RulesUrl === 'string' && cfg.s3RulesUrl.trim()
            ? cfg.s3RulesUrl.trim()
            : DEFAULT_AWS_CONFIG.s3RulesUrl;
        const s3SignatureUrl =
          typeof cfg.s3SignatureUrl === 'string' && cfg.s3SignatureUrl.trim()
            ? cfg.s3SignatureUrl.trim()
            : s3RulesUrl.endsWith('.json')
              ? `${s3RulesUrl}.sig`
              : DEFAULT_AWS_CONFIG.s3SignatureUrl;
        const telemetryEndpointUrl =
          typeof cfg.telemetryEndpointUrl === 'string' && cfg.telemetryEndpointUrl.trim()
            ? cfg.telemetryEndpointUrl.trim()
            : DEFAULT_AWS_CONFIG.telemetryEndpointUrl;
        return { s3RulesUrl, s3SignatureUrl, telemetryEndpointUrl };
      }
    }
  } catch {
    // Fall back safely outside Chrome extension runtime
  }
  return { ...DEFAULT_AWS_CONFIG };
}

/**
 * Persists custom AWS S3 / API Gateway endpoint URLs in chrome.storage.local.
 */
export async function saveAwsConfig(
  update: Partial<AwsEndpointsConfig>,
): Promise<AwsEndpointsConfig> {
  const current = await getAwsConfig();
  const s3RulesUrl =
    typeof update.s3RulesUrl === 'string' && update.s3RulesUrl.trim()
      ? update.s3RulesUrl.trim()
      : current.s3RulesUrl;
  const s3SignatureUrl =
    typeof update.s3SignatureUrl === 'string' && update.s3SignatureUrl.trim()
      ? update.s3SignatureUrl.trim()
      : typeof update.s3RulesUrl === 'string' && s3RulesUrl.endsWith('.json')
        ? `${s3RulesUrl}.sig`
        : current.s3SignatureUrl;
  const telemetryEndpointUrl =
    typeof update.telemetryEndpointUrl === 'string' && update.telemetryEndpointUrl.trim()
      ? update.telemetryEndpointUrl.trim()
      : current.telemetryEndpointUrl;

  const merged: AwsEndpointsConfig = {
    s3RulesUrl,
    s3SignatureUrl,
    telemetryEndpointUrl,
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [AWS_CONFIG_STORAGE_KEY]: merged }, () => resolve());
      });
    }
  } catch {
    // Storage unavailable outside extension context
  }

  return merged;
}

/**
 * Reads the persisted AWS synchronization and telemetry delivery status.
 */
export async function getAwsSyncStatus(): Promise<AwsSyncStatus> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.local.get([AWS_STATUS_STORAGE_KEY], (items) => resolve(items || {}));
      });
      const raw = stored[AWS_STATUS_STORAGE_KEY];
      if (raw && typeof raw === 'object') {
        return { ...DEFAULT_AWS_SYNC_STATUS, ...(raw as Partial<AwsSyncStatus>) };
      }
    }
  } catch {
    // Fall back safely outside extension context
  }
  return { ...DEFAULT_AWS_SYNC_STATUS };
}

/**
 * Merges and persists updated AWS synchronization status metrics.
 */
export async function updateAwsSyncStatus(
  partial: Partial<AwsSyncStatus>,
): Promise<AwsSyncStatus> {
  const current = await getAwsSyncStatus();
  const next: AwsSyncStatus = { ...current, ...partial };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [AWS_STATUS_STORAGE_KEY]: next }, () => resolve());
      });
    }
  } catch {
    // Ignore outside Chrome extension runtime
  }
  return next;
}

