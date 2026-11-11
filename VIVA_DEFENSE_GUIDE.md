# AegisLLM: Academic Viva & Technical Defense Guide

> **Target Audience:** Project Examiners, Evaluators, Technical Leads, and Architecture Reviewers.  
> **Repository:** `AegisLLM` — Local-First Privacy Firewall for Web LLMs.

---

## 1. 30-Second Elevator Pitch

> *"AegisLLM is a lightweight Manifest V3 browser extension that acts as a client-side privacy firewall for Claude and Gemini. As developers write prompts, AegisLLM scans their text locally using deterministic regex, Luhn checksums, and Shannon entropy. Instead of silently breaking editor state, it presents an interactive frosted-glass Spatial UI in Shadow DOM, empowering users to either Redact or intentionally Allow credentials. Crucially, a wire-level MAIN world interceptor guarantees that no secret the user chose to replace ever leaves the machine over HTTP, while an AWS S3 and DynamoDB backend provides cryptographically signed rule updates and anonymized tuning telemetry without ever seeing user data."*

---

## 2. Live Demonstration Script (Step-by-Step)

Follow this sequence during your practical demonstration to showcase all aspects of the architecture:

### Step 1: Loading & Initial Status
1. Open Google Chrome or Brave and navigate to `chrome://extensions/`.
2. Ensure **Developer mode** is on. Click **Load unpacked** and select the `dist/` directory.
3. Open the extension popup from the toolbar. Show the live **Status: Active**, zero memory footprint, and the **Protection Metrics** dashboard.

### Step 2: Demonstration on Google Gemini (`gemini.google.com`)
1. Navigate to `https://gemini.google.com`.
2. Notice the floating frosted-glass shield docked in the bottom right corner displaying `"Shield Active"`.
3. In the Gemini chat box, type or paste:
   ```text
   Here is my database key: AIzaSyD9876543210zyxwvutsrqponmlkjihgfedcba and please analyze the schema.
   ```
4. Observe the shield immediately pulse with a coral indicator and update to `"1 Secret Detected"`.
5. Click the pill or hover to open the glassmorphic Review Card. Point out:
   - Category: **Google Key (High Risk)**
   - Masked Preview: `AIzaSyD9876...`
   - Canonical Token: `[GOOGLE_API_KEY_1]`
6. Click **[🔒 Redact]**. Show that the text in Gemini's editor changes *instantly* to `[GOOGLE_API_KEY_1]` without any editor crash or state rollback.
7. Open DevTools (`F12`), go to the **Network** tab, filter by `batchexecute`, and click Send. Inspect `f.req` in the request payload to prove to examiners that `[GOOGLE_API_KEY_1]` was sent over the wire, **not** the raw API key.

### Step 3: Demonstration on Anthropic Claude (`claude.ai`)
1. Navigate to `https://claude.ai`.
2. In the Claude ProseMirror prompt box, paste an AWS key:
   ```text
   Deploy with AWS_ACCESS_KEY_ID = AKIAIOSFODNN7EXAMPLE
   ```
3. Show the review card opening with **AWS Access Key (High Risk)**.
4. Click **[✕ Leave as is]**. Show that the token displays a `"✓ Allowed"` badge.
5. Click Send in Claude. Show that because the user explicitly permitted the secret, the wire interceptor passes it through untouched without breaking the user's intended workflow.

---

## 3. Top 10 Technical Viva Questions & Defensible Answers

### Q1: Why not use a local on-device LLM (like WebLLM or Llama-3-8B in WebGPU) for PII detection?
**Answer:**  
*"An on-device LLM in WebGPU introduces three severe issues that make it impractical for a real-time typing assistant:
1. **Model Weight Bloat:** A quantized 3B or 8B model requires downloading 2 GB to 5 GB of weights into the browser cache, taking minutes on initial load. AegisLLM's entire distribution is **34.8 KB**.
2. **Inference Latency:** LLM inference takes 200ms to 800ms per prompt evaluation, causing severe keyboard lag. AegisLLM's deterministic engine runs in **0.007 ms** (7 microseconds), which is well inside the 16ms 60fps frame budget.
3. **Hallucination Risk:** LLMs are probabilistic and frequently hallucinate or miss high-entropy string tokens that do not resemble natural language words. Deterministic regex and mathematical checksums provide 100% precision on structured credentials."*

---

### Q2: How do you handle Gemini's `<rich-textarea>` and Quill editor without breaking its Virtual DOM?
**Answer:**  
*"Google Gemini uses a customized Quill editor (`.ql-editor`) hosted inside a `<rich-textarea>` custom element. Quill maintains an internal Delta/Parchment model separate from raw DOM text nodes. Simply mutating `node.nodeValue` alters the screen visually but leaves Quill's internal model stale, causing Gemini to send the old unredacted text on submission.  
AegisLLM solves this through a multi-strategy engine (`src/extension/adapters/editor_replacer.ts`):
1. It maintains persistent target locking (`lastFocusedEditor`) so clicking the Shadow DOM never drops the active editor reference.
2. It sets a DOM `Range` over the target text and executes `document.execCommand('insertText', false, placeholder)`, accompanied by composed `beforeinput` events.
3. It hooks into Quill's internal delta synchronizer (`__quill.update()`) and bubbles synthetic events to `<rich-textarea>`, ensuring Gemini's client-side state synchronizes cleanly."*

---

### Q3: Why is the Network Interceptor necessary if you already replace text in the editor DOM?
**Answer:**  
*"The Network Interceptor (`src/extension/interceptor.ts`) acts as an absolute safety net. Web applications like Gemini and Claude are complex single-page apps that can read from internal memory buffers, state stores, or web workers before or during DOM events. If a user pastes a secret and hits Send before the debounced DOM scanner finishes, or if a virtual DOM reconciliation reverts a text node, the MAIN world network interceptor hooks `window.fetch` and `XMLHttpRequest` at the byte level. It inspects outgoing HTTP payloads (`f.req` for Gemini; JSON `messages` for Claude) and guarantees that no secret the user chose to redact ever leaves the machine."*

---

### Q4: How does your AWS S3 integration work without creating a security vulnerability?
**Answer:**  
*"Simply pulling arbitrary JSON rules from an S3 bucket would introduce a remote code execution or tampering risk. AegisLLM eliminates this via **ECDSA P-256 WebCrypto digital signatures**:
1. Detection rules (`rules.v1.json`) are signed offline with an ECDSA private key.
2. The extension embeds the developer's public key in standard JWK format.
3. When the extension fetches updated rules from S3, it verifies the signature using the browser's native `window.crypto.subtle.verify()`.
4. If a single character is modified or tampered with, signature verification fails and the extension rejects the update, falling back to bundled defaults.
5. Furthermore, all fetched regular expressions pass through our `isSafeRegex` ReDoS guard, capping length at 500 characters and rejecting nested quantifiers."*

---

### Q5: How does the DynamoDB + Lambda feedback loop tune thresholds without violating privacy?
**Answer:**  
*"The telemetry pipeline enforces a strict **Zero-Plaintext Invariant**. The Lambda handler immediately rejects any payload containing fields like `prompt`, `text`, `secret`, or `key` with HTTP 400.  
It only records 4 anonymized tokens: the `detectorType`, the `userAction` (`REDACTED` or `KEPT`), confidence, and timestamp.  
In DynamoDB, we increment atomic counters to compute the **Override Rate**:
$$\text{Override Rate} = \frac{\text{KEPT}}{\text{REDACTED} + \text{KEPT}}$$
If the override rate for a detector exceeds 25%, it proves statistically that users are repeatedly choosing 'Leave as is', meaning that detector has too many false alarms. This informs us to tune the Shannon entropy threshold (e.g. from 4.0 to 4.3) without ever having seen a single word of user prompt text."*

---

### Q6: How does AegisLLM compare to Amazon Comprehend?
**Answer:**  
*"We evaluated both on an identical benchmark of 40 synthetic prompt vectors:
- **Speed:** AegisLLM's local engine achieves a P50 latency of **0.007 ms** compared to Comprehend's **166.6 ms** (> 20,000x faster).
- **Recall on Developer Credentials:** AegisLLM scored **84.6%** while Comprehend scored **50.0%**. Comprehend is an NLP model trained on natural prose, so it completely misses OpenAI keys, Claude tokens, GitHub access tokens, Gemini keys, Indian PAN, and Aadhaar.
- **Privacy:** Comprehend requires transmitting the raw, unredacted prompt over the public internet to an AWS endpoint, which directly conflicts with client-side privacy."*

---

### Q7: Why did you eliminate reverse-unmasking in replies?
**Answer:**  
*"In our early iterations, we evaluated reverse-unmasking (substituting placeholders back to raw secrets inside streaming responses). However, streaming LLM responses in Claude and Gemini are delivered via complex server-sent event (SSE) streams and WebSocket chunks that undergo frequent DOM mutations and React virtual DOM reconciliations. Mutating the response DOM in real time can break streaming chunk reconcilers and introduces the risk of accidentally displaying unmasked secrets during screen sharing. Maintaining one-way redaction is an honest, robust engineering design trade-off that guarantees stability."*

---

### Q8: What is the purpose of the Shannon Entropy scanner?
**Answer:**  
*"Regular expressions are excellent for recognized token prefixes like `sk-proj-` or `AKIA`, but developers frequently handle raw database passwords, JWT signing secrets, and custom API keys that lack prefixes. The Shannon entropy scanner calculates the information density of unformatted strings:
$$H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i)$$
Tokens with length $\ge 16$ characters and entropy score $> 4.1$ bits per symbol represent pseudo-random high-entropy strings characteristic of cryptographic secrets, allowing AegisLLM to catch zero-day and uncataloged secrets."*

---

### Q9: How do you prevent False Positives on code assets like Git commit SHAs and UUIDs?
**Answer:**  
*"We use multi-tier filtering and negative lookaheads:
1. Standard UUIDs (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`) and 40-character Git commit hashes are explicitly filtered by negative control matchers.
2. Payment cards must satisfy both regular expression formatting and the **Luhn algorithm** modulus-10 checksum; fake numbers are rejected instantly.
3. Indian Aadhaar numbers must pass the **Verhoeff algorithm** dihedral permutation group table ($D_5$), preventing random 12-digit numbers from triggering false alarms."*

---

### Q10: Why did you choose Shadow DOM for the Spatial UI?
**Answer:**  
*"Shadow DOM (`#aegis-privacy-root` with `mode: 'open'`) provides complete style and DOM encapsulation:
1. Neither Google's nor Anthropic's CSS rules can bleed into or break our frosted-glass Spatial UI.
2. AegisLLM's CSS (Navy `#0b132b`, Cream `#fdfaf6`, Coral `#ff6b6b`, `backdrop-filter: blur(16px)`) cannot leak into or alter the layout of Gemini or Claude.
3. Clicking inside the Shadow DOM is explicitly isolated so it does not trigger host blur events that would otherwise steal focus from the user's active editor."*

