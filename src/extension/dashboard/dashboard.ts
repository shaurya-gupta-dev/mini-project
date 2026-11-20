/**
 * AegisLLM Security Operations Console Controller
 * Impeccable Design: High Restraint, Precision, Deterministic Execution
 */

import { redactText } from '../../engine/detector_pipeline.js';
import { TelemetryMetrics } from '../telemetry_store.js';

interface PlatformFilter {
  selected: 'ALL' | 'Gemini' | 'Claude' | 'ChatGPT';
}

const state: {
  metrics: TelemetryMetrics;
  filter: PlatformFilter;
} = {
  metrics: {
    totalPromptsGuarded: 0,
    totalSecretsBlocked: 0,
    apiKeysBlocked: 0,
    cardsBlocked: 0,
    piiBlocked: 0,
    entropyBlocked: 0,
    privateKeysBlocked: 0,
    dbUrlsBlocked: 0,
    recentEvents: [],
  },
  filter: { selected: 'ALL' },
};

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const kpiSecretsCount = document.getElementById('kpiSecretsCount');
  const kpiPromptsCount = document.getElementById('kpiPromptsCount');
  const kpiLatency = document.getElementById('kpiLatency');

  const categoryTotalBadge = document.getElementById('categoryTotalBadge');
  const catCountApiKeys = document.getElementById('catCountApiKeys');
  const catCountPrivateKeys = document.getElementById('catCountPrivateKeys');
  const catCountDbUrls = document.getElementById('catCountDbUrls');
  const catCountCards = document.getElementById('catCountCards');
  const catCountPii = document.getElementById('catCountPii');
  const catCountEntropy = document.getElementById('catCountEntropy');

  const liveActivityFeed = document.getElementById('liveActivityFeed');
  const btnClearTelemetry = document.getElementById('btnClearTelemetry');
  const btnRefresh = document.getElementById('btnRefresh');

  // Sandbox Elements
  const sandboxInput = document.getElementById('sandboxInput') as HTMLTextAreaElement | null;
  const btnSandboxRun = document.getElementById('btnSandboxRun');
  const btnSandboxPreset = document.getElementById('btnSandboxPreset');
  const sandboxLatencyPill = document.getElementById('sandboxLatencyPill');
  const sandboxResults = document.getElementById('sandboxResults');
  const sandboxEntityCount = document.getElementById('sandboxEntityCount');
  const sandboxEntityBadges = document.getElementById('sandboxEntityBadges');
  const sandboxRedactedText = document.getElementById('sandboxRedactedText');
  const sandboxRestoredText = document.getElementById('sandboxRestoredText');

  // Platform Filter Buttons
  const navBtns = document.querySelectorAll<HTMLButtonElement>('.platform-nav .nav-btn');
  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      navBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const platform = (btn.getAttribute('data-platform') || 'ALL') as PlatformFilter['selected'];
      state.filter.selected = platform;
      renderAll();
    });
  });

  // Render Telemetry & KPIs
  function renderAll(): void {
    const m = state.metrics;
    const totalSecrets = m.totalSecretsBlocked;
    const totalPrompts = m.totalPromptsGuarded;

    if (kpiSecretsCount) kpiSecretsCount.innerText = String(totalSecrets);
    if (kpiPromptsCount) kpiPromptsCount.innerText = String(totalPrompts);
    if (kpiLatency) kpiLatency.innerText = '< 0.25 ms';

    if (categoryTotalBadge) {
      categoryTotalBadge.innerText = `${totalSecrets} Threat${totalSecrets === 1 ? '' : 's'} Intercepted`;
    }

    // Category Counts
    if (catCountApiKeys) catCountApiKeys.innerText = String(m.apiKeysBlocked || 0);
    if (catCountPrivateKeys) catCountPrivateKeys.innerText = String(m.privateKeysBlocked || 0);
    if (catCountDbUrls) catCountDbUrls.innerText = String(m.dbUrlsBlocked || 0);
    if (catCountCards) catCountCards.innerText = String(m.cardsBlocked || 0);
    if (catCountPii) catCountPii.innerText = String(m.piiBlocked || 0);
    if (catCountEntropy) catCountEntropy.innerText = String(m.entropyBlocked || 0);

    // Activity Feed
    renderActivityFeed();
  }

  function renderActivityFeed(): void {
    if (!liveActivityFeed) return;

    let events = state.metrics.recentEvents || [];
    if (state.filter.selected !== 'ALL') {
      events = events.filter((e) => e.platform.toLowerCase().includes(state.filter.selected.toLowerCase()));
    }

    if (events.length === 0) {
      liveActivityFeed.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">Zero Active Leaks Detected</div>
          <div class="empty-desc">All gateway channels (Gemini, Claude, ChatGPT) operating within secure parameters.</div>
        </div>
      `;
      return;
    }

    liveActivityFeed.innerHTML = '';
    for (const evt of events.slice(0, 10)) {
      const item = document.createElement('div');
      item.className = 'feed-item';

      const timeStr = formatRelativeTime(evt.timestamp);
      const typesSummary = Object.entries(evt.countsByType || {})
        .map(([k, v]) => `${v}x ${k.replace('_KEY', '').replace('_NUMBER', '')}`)
        .join(', ');

      const platformClass = evt.platform.toLowerCase().includes('gemini')
        ? 'gemini'
        : evt.platform.toLowerCase().includes('claude')
        ? 'claude'
        : 'chatgpt';

      item.innerHTML = `
        <div class="feed-left">
          <span class="feed-platform-tag ${platformClass}">${evt.platform}</span>
          <span class="feed-details">${typesSummary || `${evt.totalBlocked} secrets blocked`}</span>
        </div>
        <span class="feed-time">${timeStr}</span>
      `;
      liveActivityFeed.appendChild(item);
    }
  }

  function formatRelativeTime(timestamp: number): string {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  // Fetch Telemetry from background
  function fetchTelemetry(): void {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GET_TELEMETRY' }, (response) => {
          if (response && response.metrics) {
            state.metrics = response.metrics as TelemetryMetrics;
            renderAll();
          }
        });
      } else {
        // Standalone preview defaults
        state.metrics = {
          totalPromptsGuarded: 14,
          totalSecretsBlocked: 6,
          apiKeysBlocked: 3,
          cardsBlocked: 1,
          piiBlocked: 1,
          entropyBlocked: 1,
          privateKeysBlocked: 0,
          dbUrlsBlocked: 0,
          recentEvents: [
            {
              id: 'evt_demo_1',
              timestamp: Date.now() - 15000,
              platform: 'Gemini',
              totalBlocked: 1,
              countsByType: { API_KEY: 1 },
            },
            {
              id: 'evt_demo_2',
              timestamp: Date.now() - 120000,
              platform: 'Claude',
              totalBlocked: 2,
              countsByType: { API_KEY: 1, CREDIT_CARD: 1 },
            },
          ],
        };
        renderAll();
      }
    } catch {
      // Fallback
    }
  }

  const awsOverallBadge = document.getElementById('awsOverallBadge');
  const infraDynamoStatus = document.getElementById('infraDynamoStatus');
  const infraDynamoCode = document.getElementById('infraDynamoCode');
  const infraS3Status = document.getElementById('infraS3Status');
  const infraS3Code = document.getElementById('infraS3Code');
  const inputS3RulesUrl = document.getElementById('inputS3RulesUrl') as HTMLInputElement | null;
  const inputTelemetryUrl = document.getElementById('inputTelemetryUrl') as HTMLInputElement | null;
  const btnAwsSync = document.getElementById('btnAwsSync');

  interface AwsStatusResponse {
    config?: {
      s3RulesUrl?: string;
      telemetryEndpointUrl?: string;
    };
    status?: {
      rulesSource?: 's3' | 'cache' | 'bundled';
      rulesVersion?: string;
      rulesCount?: number;
      signatureVerified?: boolean;
      lastRuleError?: string | null;
      telemetryConfigured?: boolean;
      lastTelemetryStatus?: string;
      totalCloudEventsSent?: number;
    };
  }

  function renderAwsStatus(data: AwsStatusResponse): void {
    const cfg = data.config;
    const st = data.status;

    if (inputS3RulesUrl && cfg?.s3RulesUrl && !cfg.s3RulesUrl.includes('aegis-llm-rules.s3.amazonaws.com')) {
      inputS3RulesUrl.value = cfg.s3RulesUrl;
    }
    if (inputTelemetryUrl && cfg?.telemetryEndpointUrl && !cfg.telemetryEndpointUrl.includes('api.aegisllm.com')) {
      inputTelemetryUrl.value = cfg.telemetryEndpointUrl;
    }

    if (st) {
      const s3Live = st.rulesSource === 's3' && st.signatureVerified;
      const cacheLive = st.rulesSource === 'cache' && st.signatureVerified;

      if (infraS3Status) {
        infraS3Status.className = `infra-status ${s3Live || cacheLive ? 'text-emerald' : 'text-alert'}`;
        infraS3Status.innerText = s3Live ? 'VERIFIED (S3)' : cacheLive ? 'VERIFIED (CACHE)' : 'BUNDLED';
      }
      if (infraS3Code) {
        infraS3Code.innerText = s3Live
          ? `v${st.rulesVersion || '1.0.0'} (${st.rulesCount ?? 0} rules, ECDSA P-256 OK)`
          : st.lastRuleError || 'Bundled Defaults Active';
      }

      if (infraDynamoStatus) {
        infraDynamoStatus.className = `infra-status ${st.telemetryConfigured ? 'text-emerald' : 'text-alert'}`;
        infraDynamoStatus.innerText = st.telemetryConfigured ? 'CONNECTED' : 'UNCONFIGURED';
      }
      if (infraDynamoCode) {
        const sent = st.totalCloudEventsSent ?? 0;
        infraDynamoCode.innerText = st.telemetryConfigured
          ? `${st.lastTelemetryStatus || 'Ready'} (${sent} cloud events)`
          : st.lastTelemetryStatus || 'Awaiting API Gateway URL';
      }

      if (awsOverallBadge) {
        const bothLive = s3Live && st.telemetryConfigured;
        awsOverallBadge.className = `panel-meta ${bothLive ? 'text-emerald' : 'text-alert'}`;
        awsOverallBadge.innerText = bothLive
          ? 'Live AWS Connected'
          : st.telemetryConfigured || s3Live
            ? 'Partial AWS Sync'
            : 'Local Fallback Mode';
      }
    }
  }

  function fetchAwsStatus(): void {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GET_AWS_STATUS' }, (response) => {
          if (response) {
            renderAwsStatus(response as AwsStatusResponse);
          }
        });
      } else {
        renderAwsStatus({
          status: {
            rulesSource: 'bundled',
            rulesVersion: '1.0.0-bundled',
            signatureVerified: false,
            lastRuleError: 'Open extension runtime to sync S3',
            telemetryConfigured: false,
            lastTelemetryStatus: 'Standalone Preview',
          },
        });
      }
    } catch {
      // Ignore outside Chrome extension runtime
    }
  }

  fetchTelemetry();
  fetchAwsStatus();

  // Refresh Button
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchTelemetry();
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'SYNC_AWS_RULES' }, (response) => {
            if (response) renderAwsStatus(response as AwsStatusResponse);
          });
        }
      } catch {
        // Ignore
      }
    });
  }

  if (btnAwsSync) {
    btnAwsSync.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(
            {
              type: 'SAVE_AWS_CONFIG',
              config: {
                s3RulesUrl: inputS3RulesUrl?.value?.trim() || undefined,
                telemetryEndpointUrl: inputTelemetryUrl?.value?.trim() || undefined,
              },
            },
            (response) => {
              if (response) renderAwsStatus(response as AwsStatusResponse);
            }
          );
        }
      } catch {
        // Ignore
      }
    });
  }

  // Clear Telemetry
  if (btnClearTelemetry) {
    btnClearTelemetry.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'RESET_TELEMETRY' }, () => {
            fetchTelemetry();
          });
        } else {
          state.metrics = {
            totalPromptsGuarded: 0,
            totalSecretsBlocked: 0,
            apiKeysBlocked: 0,
            cardsBlocked: 0,
            piiBlocked: 0,
            entropyBlocked: 0,
            privateKeysBlocked: 0,
            dbUrlsBlocked: 0,
            recentEvents: [],
          };
          renderAll();
        }
      } catch {
        // Fallback
      }
    });
  }

  // Sandbox Simulator Execution
  function runSimulation(): void {
    if (!sandboxInput || !sandboxResults) return;
    const text = sandboxInput.value.trim();
    if (!text) return;

    const t0 = performance.now();
    const res = redactText(text);
    const elapsed = (performance.now() - t0).toFixed(2);

    if (sandboxLatencyPill) {
      sandboxLatencyPill.innerText = `${elapsed} ms`;
      sandboxLatencyPill.classList.remove('hidden');
    }

    if (sandboxEntityCount) sandboxEntityCount.innerText = String(res.entities.length);

    if (sandboxEntityBadges) {
      sandboxEntityBadges.innerHTML = '';
      if (res.entities.length === 0) {
        sandboxEntityBadges.innerHTML = '<span class="entity-pill-badge" style="color: #10b981; border-color: rgba(16,185,129,0.3)">Clean (No Secrets)</span>';
      } else {
        for (const entity of res.entities) {
          const badge = document.createElement('span');
          badge.className = 'entity-pill-badge';
          badge.innerText = `${entity.type}: ${entity.raw.substring(0, 10)}...`;
          sandboxEntityBadges.appendChild(badge);
        }
      }
    }

    if (sandboxRedactedText) sandboxRedactedText.innerText = res.redactedText;
    if (sandboxRestoredText) sandboxRestoredText.innerText = text;

    sandboxResults.classList.remove('hidden');
  }

  if (btnSandboxRun) {
    btnSandboxRun.addEventListener('click', runSimulation);
  }

  // Preset YAML Sample
  if (btnSandboxPreset && sandboxInput) {
    btnSandboxPreset.addEventListener('click', () => {
      sandboxInput.value = `custom_providers:
  - name: "APInex"
    base_url: "https://api.apinex.bond/v1"
    key_env: "cmp438078272436591415144cbd44b149a9Y"
    api_mode: "chat_completions"
model:
  default: "free/glm-5.3-flash"
  provider: "custom:apinex"`;
      runSimulation();
    });
  }
});
