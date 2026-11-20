/**
 * AegisLLM Background Service Worker (Manifest V3)
 * Manages cross-tab badge counters, persistent telemetry store, AWS S3 signed rule pack sync,
 * and anonymized AWS Lambda/DynamoDB decision telemetry dispatch.
 */

import { defaultTelemetryStore } from './telemetry_store.js';
import { EntityType } from '../engine/types.js';
import { loadRulePackWithSource } from '../engine/rule_loader.js';
import { recordAnonymizedDecisionWithStatus } from './telemetry_client.js';
import {
  getAwsConfig,
  saveAwsConfig,
  getAwsSyncStatus,
  updateAwsSyncStatus,
  isPlaceholderAwsUrl,
  AwsEndpointsConfig,
} from './aws_config.js';

/**
 * Fetches & ECDSA-verifies dynamic rules from S3 (when configured) and updates sync status.
 */
async function syncAwsRulePack(): Promise<ReturnType<typeof getAwsSyncStatus>> {
  const cfg = await getAwsConfig();
  const s3Configured = !isPlaceholderAwsUrl(cfg.s3RulesUrl);
  const telemetryConfigured = !isPlaceholderAwsUrl(cfg.telemetryEndpointUrl);

  if (!s3Configured) {
    return updateAwsSyncStatus({
      rulesSource: 'bundled',
      rulesVersion: '1.0.0-bundled',
      signatureVerified: false,
      lastRuleSyncAt: Date.now(),
      lastRuleError: 'Awaiting S3 Bucket URL',
      telemetryConfigured,
    });
  }

  try {
    const result = await loadRulePackWithSource({
      rulePackUrl: cfg.s3RulesUrl,
      signatureUrl: cfg.s3SignatureUrl,
    });

    return updateAwsSyncStatus({
      rulesSource: result.source,
      rulesVersion: result.pack.version,
      rulesCount: result.pack.rules.length,
      signatureVerified: result.signatureVerified,
      lastRuleSyncAt: result.syncedAt,
      lastRuleError:
        result.source === 's3'
          ? null
          : 'Remote S3 fetch failed or rejected; using fallback',
      telemetryConfigured,
    });
  } catch (err) {
    return updateAwsSyncStatus({
      rulesSource: 'bundled',
      signatureVerified: false,
      lastRuleSyncAt: Date.now(),
      lastRuleError: err instanceof Error ? err.message : 'S3 sync error',
      telemetryConfigured,
    });
  }
}

/**
 * Dispatches anonymized REDACTED/KEPT decisions to AWS API Gateway -> Lambda -> DynamoDB.
 */
async function dispatchCloudTelemetry(
  entityTypes: string[],
  userAction: 'REDACTED' | 'KEPT'
): Promise<void> {
  if (!Array.isArray(entityTypes) || entityTypes.length === 0) return;

  const cfg = await getAwsConfig();
  const telemetryConfigured = !isPlaceholderAwsUrl(cfg.telemetryEndpointUrl);
  if (!telemetryConfigured) {
    await updateAwsSyncStatus({
      telemetryConfigured: false,
      lastTelemetryStatus: 'Awaiting API Gateway URL',
    });
    return;
  }

  const results = await Promise.all(
    entityTypes.map((detectorType) =>
      recordAnonymizedDecisionWithStatus({
        detectorType,
        userAction,
        confidence: 0.95,
        endpointUrl: cfg.telemetryEndpointUrl,
      })
    )
  );

  const sentCount = results.filter((r) => r.sent).length;
  const firstFail = results.find((r) => !r.sent);
  const current = await getAwsSyncStatus();

  await updateAwsSyncStatus({
    telemetryConfigured: true,
    lastTelemetryAt: Date.now(),
    totalCloudEventsSent: current.totalCloudEventsSent + sentCount,
    lastTelemetryStatus:
      sentCount > 0
        ? `Recorded ${sentCount} (${userAction})`
        : firstFail?.reason || 'Dispatch failed',
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(async () => {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981' });

    const metrics = await defaultTelemetryStore.getMetrics();
    if (metrics.totalSecretsBlocked > 0) {
      chrome.action.setBadgeText({ text: String(metrics.totalSecretsBlocked) });
      chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
    }

    await syncAwsRulePack();
    console.log('[AegisLLM] Service Worker initialized with telemetry & AWS sync.');
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(async () => {
      await syncAwsRulePack();
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === 'AEGIS_SECRETS_REDACTED') {
        const platform = message.platform || 'Unknown Web LLM';
        const entityTypes: EntityType[] = message.entityTypes || [];

        const updated = await defaultTelemetryStore.recordInterception(platform, entityTypes);

        chrome.action.setBadgeText({ text: String(updated.totalSecretsBlocked) });
        chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });

        void dispatchCloudTelemetry(entityTypes, 'REDACTED');
        sendResponse({ status: 'OK', total: updated.totalSecretsBlocked, metrics: updated });
      } else if (message.type === 'AEGIS_TELEMETRY_DECISION') {
        const entityTypes: string[] = Array.isArray(message.entityTypes)
          ? message.entityTypes
          : [];
        const userAction = message.userAction === 'KEPT' ? 'KEPT' : 'REDACTED';
        void dispatchCloudTelemetry(entityTypes, userAction);
        sendResponse({ status: 'DISPATCHED' });
      } else if (message.type === 'GET_STATS' || message.type === 'GET_TELEMETRY') {
        const metrics = await defaultTelemetryStore.getMetrics();
        sendResponse({
          status: 'ACTIVE',
          totalProtected: metrics.totalSecretsBlocked,
          metrics,
        });
      } else if (message.type === 'RESET_TELEMETRY') {
        await defaultTelemetryStore.resetMetrics();
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
        sendResponse({ status: 'RESET_OK' });
      } else if (message.type === 'GET_AWS_STATUS') {
        const [config, status] = await Promise.all([getAwsConfig(), getAwsSyncStatus()]);
        sendResponse({ config, status });
      } else if (message.type === 'SYNC_AWS_RULES') {
        const status = await syncAwsRulePack();
        const config = await getAwsConfig();
        sendResponse({ config, status });
      } else if (message.type === 'SAVE_AWS_CONFIG') {
        const payload = (message.config || {}) as Partial<AwsEndpointsConfig>;
        const config = await saveAwsConfig(payload);
        const status = await syncAwsRulePack();
        sendResponse({ config, status });
      }
    })();

    return true;
  });
}
