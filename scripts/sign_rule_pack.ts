/**
 * AegisLLM Offline Rule Pack Signing Tool
 * Uses ECDSA P-256 (SHA-256) WebCrypto API to generate signatures and public keys.
 * Compatible with Chrome extension client-side WebCrypto signature verification.
 */

import * as fs from 'fs';
import * as path from 'path';

const KEYS_DIR = path.resolve('keys');
const RULE_PACKS_DIR = path.resolve('rule_packs');
const ENGINE_DIR = path.resolve('src/engine');

const PRIVATE_KEY_FILE = path.join(KEYS_DIR, 'rule_signing_private_jwk.json');
const PUBLIC_KEY_FILE = path.join(ENGINE_DIR, 'rule_signing_pubkey.json');
const TARGET_RULES_FILE = path.join(RULE_PACKS_DIR, 'rules.v1.json');
const SIGNATURE_FILE = path.join(RULE_PACKS_DIR, 'rules.v1.json.sig');

async function main() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }
  if (!fs.existsSync(RULE_PACKS_DIR)) {
    fs.mkdirSync(RULE_PACKS_DIR, { recursive: true });
  }

  let privateKeyJwk: JsonWebKey;
  let publicKeyJwk: JsonWebKey;

  if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE)) {
    console.log('[Signer] Loading existing ECDSA P-256 keypair...');
    privateKeyJwk = JSON.parse(fs.readFileSync(PRIVATE_KEY_FILE, 'utf-8'));
    publicKeyJwk = JSON.parse(fs.readFileSync(PUBLIC_KEY_FILE, 'utf-8'));
  } else {
    console.log('[Signer] Generating fresh ECDSA P-256 keypair via WebCrypto...');
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['sign', 'verify']
    );

    privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    // Save private key (kept out of distribution)
    fs.writeFileSync(PRIVATE_KEY_FILE, JSON.stringify(privateKeyJwk, null, 2));
    // Save public key (bundled in extension for signature verification)
    fs.writeFileSync(PUBLIC_KEY_FILE, JSON.stringify(publicKeyJwk, null, 2));
    console.log(`[Signer] Saved public key to ${PUBLIC_KEY_FILE}`);
  }

  // Import private key for signing
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false,
    ['sign']
  );

  // Read target rule pack content
  if (!fs.existsSync(TARGET_RULES_FILE)) {
    throw new Error(`Rules file not found at ${TARGET_RULES_FILE}`);
  }
  const rulesContent = fs.readFileSync(TARGET_RULES_FILE, 'utf-8');
  const rulesBuffer = new TextEncoder().encode(rulesContent);

  // Sign data using ECDSA P-256 SHA-256 (produces 64-byte raw IEEE P1363 signature)
  const signatureBuffer = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    privateKey,
    rulesBuffer
  );

  const signatureBase64 = Buffer.from(signatureBuffer).toString('base64');
  fs.writeFileSync(SIGNATURE_FILE, signatureBase64, 'utf-8');
  console.log(`[Signer] Signed ${TARGET_RULES_FILE}`);
  console.log(`[Signer] Signature written to ${SIGNATURE_FILE} (${signatureBase64.length} chars)`);

  // Quick self-verification check
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false,
    ['verify']
  );

  const isValid = await crypto.subtle.verify(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    publicKey,
    signatureBuffer,
    rulesBuffer
  );

  console.log(`[Signer] Self-verification: ${isValid ? 'PASSED (Signature is valid)' : 'FAILED'}`);
}

main().catch((err) => {
  console.error('[Signer] Fatal error:', err);
  process.exit(1);
});

