# AegisLLM: Interactive Spatial Privacy Assistant for Web LLMs

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7.2-blue.svg)](https://www.typescriptlang.org/)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests](https://img.shields.io/badge/Tests-168_Passed-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-MIT-purple.svg)]()

> **One-Line Mission:** A lightweight Chrome/Brave extension that flags sensitive credentials and PII in prompts on Claude and Gemini, gives the user transparent "Replace" or "Keep" control via a frosted-glass Spatial UI, and guarantees at the network wire that no secret the user chose to replace ever leaves the device. AWS powers signed rule updates, opt-in privacy telemetry, and an honest synthetic benchmark.

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Client ["Client Browser (Chrome / Brave)"]
        User["User Typing Prompt"] --> Editor["Editor DOM (Quill / ProseMirror)"]
        Editor -->|Debounced 150ms Scan| Scanner["Deterministic Scanner<br/>(Regex + Luhn + Entropy)"]
        Scanner -->|Flags Secrets| Shield["Spatial Privacy Shield<br/>(#aegis-privacy-root Shadow DOM)"]
        
        Shield -->|User clicks 'Replace'| Replacer["In-Place Editor Replacer<br/>(insertText + Delta update)"]
        Shield -->|User clicks 'Leave as is'| Whitelist["Allowed Secrets Set"]
        
        Editor -->|User clicks Submit| WireInterceptor["MAIN World Wire Safety Net<br/>(fetch & XHR Interceptor)"]
        Whitelist -->|Passes untouched| WireInterceptor
        Replacer -->|Replaced to [TOKEN]| WireInterceptor
    end

    subgraph AWS ["AWS Cloud Infrastructure (Outside Data Path)"]
        S3["AWS S3 Bucket<br/>(Signed rules.v1.json + .sig)"] -.->|Dynamic Rules| Scanner
        Shield -.->|Opt-in Anonymized Decisions| Lambda["AWS Lambda Ingestion"]
        Lambda -->|Atomic Aggregates| DDB[("Amazon DynamoDB<br/>AegisTelemetry")]
        Comp["Amazon Comprehend"] -.->|Offline Synthetic Eval| BenchmarkReport["Viva Benchmark"]
    end

    WireInterceptor -->|Guaranteed Sanitized Request| CloudLLMs["Claude & Gemini Cloud APIs"]
```

---

## 2. Prime Behavior Rules (Constitution)

1. **Flag, Never Silently Rewrite:** The prompt scanner monitors typing in the background. It flags detected entities and presents the user with transparent choices: **[🔒 Redact]**, **[✕ Leave as is]**, or **[🔒 Redact All]**.
2. **The Wire Layer is a Safety Net, Not an Autopilot:**
   - **Replaced Secret:** Any secret marked for replacement that remains in an outgoing HTTP payload is sanitized to its canonical token (`[GOOGLE_API_KEY_1]`).
   - **Kept Secret:** Any secret explicitly allowed by the user passes through the wire 100% untouched.
   - **Unresolved Flag:** If the user presses Send while high-risk secrets remain unhandled, the review card opens to alert the user.
3. **Core Acceptance Guarantee:** *"No secret the user chose to replace ever appears in the outgoing network request."* This is verified from DevTools Network payloads, not just DOM text.
4. **Replies:** One-way redaction. Documented honestly as a design trade-off to eliminate fragile reverse-mutation of streaming responses.
5. **Session Vault:** Strictly in-memory. Zero secrets are written to disk, cookies, or persistent browser storage.

---

## 3. Spatial UI & Glassmorphism Design

The UI is built as an interactive **Spatial Assistant** fully isolated inside a Shadow DOM (`#aegis-privacy-root`):

- **Palette:**
  - **Navy** (`#0b132b`): Deep, authoritative background with `backdrop-filter: blur(16px)` and glass borders (`rgba(255, 255, 255, 0.1)`).
  - **Cream** (`#fdfaf6`): High-contrast typography and subtle secondary text (`rgba(253, 250, 246, 0.7)`).
  - **Coral** (`#ff6b6b`): Pulsing warning indicators and high-priority danger badges.
- **Floating Pill:** Docks unobtrusively near the chat input container:
  - *Quiet State:* `"Shield Active"` (dim green indicator).
  - *Active Warning State:* `"N Secrets Detected"` with coral pulse and badge counter.
- **Review Card:**
  - Masked secret previews (e.g., `sk-ant-api03-...`, `AIzaSyD987...`, `4532-****-****-0366`).
  - Risk categorization badges (**Critical Risk**, **High Risk**, **Medium Risk**).
  - Action buttons: `[🔒 Redact]` (replaces in-place) and `[✕ Leave as is]` (marks secret as allowed).
  - Card stays open stably without premature hover collapse until dismissed.

---

## 4. Supported Platforms & Editor Integration

AegisLLM is 100% focused on providing flawless integration on the two leading AI interfaces:

### 4.1 Google Gemini (`gemini.google.com`)
- **Editor Architecture:** Custom `<rich-textarea>` containing a Quill-based `.ql-editor` contenteditable div with `<p>` child nodes.
- **Target Locking:** Persistent tracking (`lastFocusedEditor`) guarantees that clicking buttons inside the Shadow DOM never drops focus on Gemini's editor.
- **In-Place Replacement:** Dispatches composed `beforeinput` and `InputEvent('insertText')` events across the DOM hierarchy and hooks into Quill's internal Delta model (`__quill.update()`).
- **Wire Interception:** Surgically intercepts `f.req` in `batchexecute` and `StreamGenerate` RPC payloads, leaving Google's `at` (XSRF token) and session parameters byte-for-byte untouched.

### 4.2 Anthropic Claude (`claude.ai`)
- **Editor Architecture:** `div[contenteditable="true"].ProseMirror`.
- **In-Place Replacement:** DOM `Range` selection + `document.execCommand('insertText')` integrates cleanly into ProseMirror's transaction pipeline.
- **Wire Interception:** Intercepts `/chat_conversations/...` and `/messages` JSON payloads, sanitizing user message text blocks while preserving models, tool definitions, and metadata.

---

## 5. The Three AWS Integration Pillars

AegisLLM pairs on-device local execution with cloud infrastructure outside the sensitive data path:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AWS INTEGRATION PILLARS                         │
├───────────────────────┬────────────────────────┬───────────────────────┤
│  1. DynamoDB + Lambda │    2. Amazon S3        │  3. Amazon Comprehend │
│    Telemetry Loop     │   Signed Rule Packs    │   Offline Benchmark   │
├───────────────────────┼────────────────────────┼───────────────────────┤
│ Ingests anonymized    │ Ships versioned rule   │ Evaluates precision,  │
│ decision counters:    │ packs (rules.v1.json)  │ recall, and latency   │
│ REDACTED vs KEPT.     │ signed with ECDSA      │ against cloud NLP     │
│ Computes override     │ P-256 WebCrypto.       │ on 40 synthetic       │
│ rates to tune entropy │ Dynamic updates        │ prompts.              │
│ thresholds. Zero      │ without Chrome Web     │ Proves local engine   │
│ plaintext entered.    │ Store republication.   │ is > 20,000x faster.  │
└───────────────────────┴────────────────────────┴───────────────────────┘
```

Detailed architectural diagrams, mathematical formulas, and SAM templates are documented in [AWS_INTEGRATION.md](file:///c:/Users/dhruv/Documents/GitHub/mini%20project/AWS_INTEGRATION.md).

---

## 6. Empirical Performance Benchmarks

Evaluated on 40 diverse synthetic prompt vectors (credentials, payment cards, national IDs, and hard negative code snippets):

| Metric | AegisLLM (Local Engine) | Amazon Comprehend (Cloud API) | Difference |
|---|:---:|:---:|:---:|
| **P50 Latency** | **0.007 ms** | **166.6 ms** | **> 20,000x faster** |
| **P95 Latency** | **0.024 ms** | **189.2 ms** | Real-time typing budget ($<$ 5ms) |
| **Recall (Dev Credentials)** | **84.6%** | **50.0%** | Comprehend misses OpenAI, Claude, GitHub, Gemini |
| **False Positives** | **0** | **0** | Zero false alarms on UUIDs, git hashes, code math |
| **Network Data Exposure** | **0 bytes** | **Full prompt sent** | Zero-leakage privacy guarantee |

---

## 7. Installation & Quickstart

### Prerequisites
- Node.js v18+ (tested on Node v22.23.2)
- Google Chrome or Brave Browser

### Build & Run
```bash
# 1. Install dependencies
npm install

# 2. Run the test suite (168 tests across 14 test suites)
npm test

# 3. Build production bundles
npm run build

# 4. Generate release zip package
npm run pack
# Output: dist/aegis-llm-v1.0.0.zip (34.8 KB)
```

### Load Unpacked Extension in Chrome or Brave
1. Open Chrome or Brave and navigate to `chrome://extensions/` (or `brave://extensions/`).
2. Toggle on **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the `dist/` directory from this repository:
   `c:\Users\dhruv\Documents\GitHub\mini project\dist`
5. AegisLLM is now active! Navigate to `gemini.google.com` or `claude.ai` to experience the spatial privacy shield.

---

## 8. Repository Structure

```
├── dist/                          # Production distribution bundle
│   ├── manifest.json              # Manifest V3 configuration
│   ├── content.js                 # Content script & Spatial Shield (IIFE)
│   ├── interceptor.js             # MAIN world wire-level interceptor (IIFE)
│   ├── background.js              # Service worker (session vault sync)
│   └── popup/                     # Extension dashboard popup
├── infra/
│   └── template.yaml              # AWS SAM CloudFormation template (DynamoDB + Lambda)
├── rule_packs/
│   ├── rules.v1.json              # Versioned rule pack schema
│   └── rules.v1.json.sig          # ECDSA P-256 digital signature (base64)
├── scripts/
│   ├── sign_rule_pack.ts          # Offline ECDSA P-256 WebCrypto signing tool
│   ├── benchmark_comprehend.ts    # Synthetic benchmark runner
│   └── pack_extension.js          # Distributable zip packager
├── src/
│   ├── aws/                       # Lambda telemetry handler & zero-plaintext validator
│   ├── engine/                    # Deterministic regex, Luhn, Verhoeff & entropy scanner
│   ├── extension/                 # Spatial UI, editor replacer, adapters & wire interceptor
│   └── vault/                     # Ephemeral session vault
├── tests/                         # 14 test suites (168 unit & integration tests)
├── AWS_INTEGRATION.md             # In-depth AWS architecture & feedback loop specification
└── VIVA_DEFENSE_GUIDE.md          # Comprehensive viva defense questions & answers
```

---

## 9. License

MIT License. Designed and engineered for privacy-preserving AI development.

