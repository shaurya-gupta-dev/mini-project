/**
 * AegisLLM Background Service Worker (Manifest V3)
 * Manages cross-tab badge counters, persistent telemetry store, and popup communication.
 */

import { defaultTelemetryStore } from './telemetry_store.js';
import { EntityType } from '../engine/types.js';

if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Update badge on install
  chrome.runtime.onInstalled.addListener(async () => {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981' }); // Green for active protection

    const metrics = await defaultTelemetryStore.getMetrics();
    if (metrics.totalSecretsBlocked > 0) {
      chrome.action.setBadgeText({ text: String(metrics.totalSecretsBlocked) });
      chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
    }
    console.log('[AegisLLM] Service Worker initialized with telemetry persistence.');
  });

  // Listen for messages from content scripts and popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === 'AEGIS_SECRETS_REDACTED') {
        const platform = message.platform || 'Unknown Web LLM';
        const entityTypes: EntityType[] = message.entityTypes || [];

        const updated = await defaultTelemetryStore.recordInterception(platform, entityTypes);

        chrome.action.setBadgeText({ text: String(updated.totalSecretsBlocked) });
        chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });

        sendResponse({ status: 'OK', total: updated.totalSecretsBlocked, metrics: updated });
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
      }
    })();

    return true; // Keep message channel open for async response
  });
}
