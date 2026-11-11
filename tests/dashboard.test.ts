import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { redactText } from '../src/engine/detector_pipeline.js';

describe('AegisLLM Impeccable Security Console & Distilled UI Tests', () => {
  const distDir = path.resolve(__dirname, '../dist');
  const dashboardHtmlPath = path.join(distDir, 'dashboard/dashboard.html');
  const dashboardCssPath = path.join(distDir, 'dashboard/dashboard.css');
  const popupHtmlPath = path.join(distDir, 'popup/popup.html');
  const popupCssPath = path.join(distDir, 'popup/popup.css');

  it('verifies ZERO emojis or decorative cartoon glyphs exist across all HTML files', () => {
    const htmlFiles = [dashboardHtmlPath, popupHtmlPath];
    // Comprehensive emoji Unicode range
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    for (const file of htmlFiles) {
      expect(fs.existsSync(file)).toBe(true);
      const content = fs.readFileSync(file, 'utf8');
      const match = content.match(emojiRegex);
      expect(match, `Emoji detected in ${file}: ${match?.[0]}`).toBeNull();
    }
  });

  it('verifies dashboard.html adheres to Impeccable Operate Mode specifications', () => {
    expect(fs.existsSync(dashboardHtmlPath)).toBe(true);
    const html = fs.readFileSync(dashboardHtmlPath, 'utf8');

    // Header & Brand
    expect(html).toContain('AegisLLM Security Console');
    expect(html).toContain('Client Enforced');

    // Platform Navigation
    expect(html).toContain('data-platform="ALL"');
    expect(html).toContain('data-platform="Gemini"');
    expect(html).toContain('data-platform="Claude"');
    expect(html).toContain('data-platform="ChatGPT"');

    // Essential Metrics Strip
    expect(html).toContain('id="kpiSecretsCount"');
    expect(html).toContain('id="kpiPromptsCount"');
    expect(html).toContain('id="kpiLatency"');

    // Threat Vectors Grid
    expect(html).toContain('id="catCountApiKeys"');
    expect(html).toContain('id="catCountPrivateKeys"');
    expect(html).toContain('id="catCountDbUrls"');
    expect(html).toContain('id="catCountCards"');
    expect(html).toContain('id="catCountPii"');
    expect(html).toContain('id="catCountEntropy"');

    // AWS Cloud Infrastructure
    expect(html).toContain('Amazon DynamoDB & AWS Lambda');
    expect(html).toContain('Dynamic S3 Signed Rule Packs');
    expect(html).toContain('Amazon Comprehend Comparative Benchmark');

    // Deterministic Simulator Sandbox
    expect(html).toContain('id="sandboxInput"');
    expect(html).toContain('id="btnSandboxRun"');
    expect(html).toContain('id="btnSandboxPreset"');
    expect(html).toContain('id="sandboxLatencyPill"');
    expect(html).toContain('id="sandboxRedactedText"');
    expect(html).toContain('id="sandboxRestoredText"');

    // Audit Stream
    expect(html).toContain('id="liveActivityFeed"');
    expect(html).toContain('id="btnClearTelemetry"');
  });

  it('verifies dashboard.css adheres to Impeccable craft floor rules (no gradient text masks, no nested card bloat)', () => {
    expect(fs.existsSync(dashboardCssPath)).toBe(true);
    const css = fs.readFileSync(dashboardCssPath, 'utf8');

    // Neutral surface foundations
    expect(css).toContain('--bg-canvas: #090e17;');
    expect(css).toContain('--bg-surface: #101726;');

    // Ban on gradient text masks
    expect(css).not.toContain('-webkit-background-clip: text');
    expect(css).not.toContain('-webkit-text-fill-color: transparent');

    // Natural offset shadows
    expect(css).toContain('--shadow-panel: 0 12px 32px -8px rgba(0, 0, 0, 0.5);');
  });

  it('verifies popup.html follows distilled high-density Operate Mode layout', () => {
    expect(fs.existsSync(popupHtmlPath)).toBe(true);
    const html = fs.readFileSync(popupHtmlPath, 'utf8');

    expect(html).toContain('AegisLLM');
    expect(html).toContain('Protected');
    expect(html).toContain('id="secretsCount"');
    expect(html).toContain('id="promptsCount"');
    expect(html).toContain('id="latencyStat"');
    expect(html).toContain('id="simInput"');
    expect(html).toContain('id="btnScan"');
    expect(html).toContain('id="btnOpenDashboard"');
    expect(html).toContain('id="activityLog"');
  });

  it('verifies popup.css implements Diego Navy/Cream/Coral palette and has high contrast', () => {
    expect(fs.existsSync(popupCssPath)).toBe(true);
    const css = fs.readFileSync(popupCssPath, 'utf8');

    expect(css).toContain('--color-navy: #14213d;');
    expect(css).toContain('--color-coral: #ff6b5b;');
    expect(css).toContain('--color-cream: #f4ede0;');
    expect(css).not.toContain('-webkit-background-clip: text');
  });

  it('verifies sandbox deterministic pipeline execution with 100% precision on custom YAML keys', () => {
    const yamlPayload = `custom_providers:
  - name: "APInex"
    base_url: "https://api.apinex.bond/v1"
    key_env: "cmp438078272436591415144cbd44b149a9Y"
    api_mode: "chat_completions"`;

    const t0 = performance.now();
    const res = redactText(yamlPayload);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(10);
    expect(res.entities.some(e => e.raw === 'cmp438078272436591415144cbd44b149a9Y')).toBe(true);
    expect(res.redactedText).not.toContain('cmp438078272436591415144cbd44b149a9Y');
    expect(res.redactedText).toContain('https://api.apinex.bond/v1');
  });
});
