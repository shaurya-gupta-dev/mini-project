/**
 * AegisLLM Extension Popup Controller
 * Connects UI to TelemetryStore, background worker, live scanner, and Spatial Dashboard launch.
 */

import { redactText } from '../../engine/detector_pipeline.js';
import { TelemetryMetrics } from '../telemetry_store.js';

document.addEventListener('DOMContentLoaded', () => {
  const secretsCountEl = document.getElementById('secretsCount');
  const promptsCountEl = document.getElementById('promptsCount');
  const catApiKeysEl = document.getElementById('catApiKeys');
  const catPrivateKeysEl = document.getElementById('catPrivateKeys');
  const catDbUrlsEl = document.getElementById('catDbUrls');
  const catCardsEl = document.getElementById('catCards');
  const catPiiEl = document.getElementById('catPii');
  const catEntropyEl = document.getElementById('catEntropy');
  const activityLogEl = document.getElementById('activityLog');
  const btnClear = document.getElementById('btnClear');
  const btnOpenDashboard = document.getElementById('btnOpenDashboard');

  const simInput = document.getElementById('simInput') as HTMLTextAreaElement | null;
  const btnScan = document.getElementById('btnScan');
  const scanTimer = document.getElementById('scanTimer');
  const simResults = document.getElementById('simResults');
  const simRedacted = document.getElementById('simRedacted');
  const simEntities = document.getElementById('simEntities');

  // Launch Full Spatial Dashboard
  if (btnOpenDashboard) {
    btnOpenDashboard.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
        } else {
          window.open('../dashboard/dashboard.html', '_blank');
        }
      } catch {
        window.open('../dashboard/dashboard.html', '_blank');
      }
    });
  }

  function renderMetrics(metrics: TelemetryMetrics): void {
    if (secretsCountEl) secretsCountEl.innerText = String(metrics.totalSecretsBlocked);
    if (promptsCountEl) promptsCountEl.innerText = String(metrics.totalPromptsGuarded);
    if (catApiKeysEl) catApiKeysEl.innerText = String(metrics.apiKeysBlocked);
    if (catPrivateKeysEl) catPrivateKeysEl.innerText = String(metrics.privateKeysBlocked || 0);
    if (catDbUrlsEl) catDbUrlsEl.innerText = String(metrics.dbUrlsBlocked || 0);
    if (catCardsEl) catCardsEl.innerText = String(metrics.cardsBlocked);
    if (catPiiEl) catPiiEl.innerText = String(metrics.piiBlocked);
    if (catEntropyEl) catEntropyEl.innerText = String(metrics.entropyBlocked);

    if (activityLogEl) {
      if (!metrics.recentEvents || metrics.recentEvents.length === 0) {
        activityLogEl.innerHTML = '<div class="empty-log">Zero active leaks. Gemini, Claude & ChatGPT secure.</div>';
      } else {
        activityLogEl.innerHTML = '';
        for (const evt of metrics.recentEvents.slice(0, 5)) {
          const item = document.createElement('div');
          item.className = 'activity-item';

          const timeStr = formatRelativeTime(evt.timestamp);
          const typesSummary = Object.entries(evt.countsByType || {})
            .map(([k, v]) => `${v}x ${k.replace('_KEY', '').replace('_NUMBER', '')}`)
            .join(', ');

          item.innerHTML = `
            <span class="activity-platform">${evt.platform}</span>
            <span class="activity-summary">${typesSummary || `${evt.totalBlocked} secrets blocked`}</span>
            <span class="activity-time">${timeStr}</span>
          `;
          activityLogEl.appendChild(item);
        }
      }
    }
  }

  function formatRelativeTime(timestamp: number): string {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  // Fetch telemetry from background worker
  function refreshTelemetry(): void {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GET_TELEMETRY' }, (response) => {
          if (response && response.metrics) {
            renderMetrics(response.metrics as TelemetryMetrics);
          }
        });
      }
    } catch {
      // Standalone mode preview
    }
  }

  refreshTelemetry();

  // Reset telemetry
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'RESET_TELEMETRY' }, () => {
            renderMetrics({
              totalPromptsGuarded: 0,
              totalSecretsBlocked: 0,
              apiKeysBlocked: 0,
              cardsBlocked: 0,
              piiBlocked: 0,
              entropyBlocked: 0,
              privateKeysBlocked: 0,
              dbUrlsBlocked: 0,
              recentEvents: [],
            });
          });
        }
      } catch {
        // Fallback
      }
    });
  }

  // Interactive Live Scanner Playground
  if (btnScan && simInput && simResults && simRedacted && simEntities && scanTimer) {
    btnScan.addEventListener('click', () => {
      const text = simInput.value.trim();
      if (!text) return;

      const t0 = performance.now();
      const res = redactText(text);
      const elapsed = (performance.now() - t0).toFixed(2);

      scanTimer.innerText = `${elapsed} ms`;
      scanTimer.classList.remove('hidden');
      simRedacted.innerText = res.redactedText;
      simEntities.innerHTML = '';

      if (res.entities.length === 0) {
        simEntities.innerHTML = '<span class="entity-pill" style="color: #34d399; border-color: rgba(52,211,153,0.3)">No secrets detected</span>';
      } else {
        for (const entity of res.entities) {
          const pill = document.createElement('span');
          pill.className = 'entity-pill';
          pill.innerText = `${entity.type}: ${entity.raw.substring(0, 8)}...`;
          simEntities.appendChild(pill);
        }
      }

      simResults.classList.remove('hidden');
    });
  }
});
