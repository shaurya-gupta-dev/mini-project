import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionVault } from '../src/vault/session_vault.js';

describe('SessionVault: Multi-Turn State Machine & Isolation', () => {
  let vault: SessionVault;

  beforeEach(() => {
    vault = new SessionVault(300); // 5 min TTL
  });

  it('allocates sequential placeholders for distinct secrets', () => {
    const s1 = vault.registerSecret('sess_1', 'user1@example.com', 'EMAIL');
    const s2 = vault.registerSecret('sess_1', 'user2@example.com', 'EMAIL');
    const k1 = vault.registerSecret('sess_1', 'sk-proj-1234567890abcdef', 'OPENAI_API_KEY');

    expect(s1).toBe('[EMAIL_1]');
    expect(s2).toBe('[EMAIL_2]');
    expect(k1).toBe('[OPENAI_API_KEY_1]');
  });

  it('reuses the existing placeholder when the same secret appears in multiple turns', () => {
    const firstTurn = vault.registerSecret('sess_1', 'admin@bank.com', 'EMAIL');
    const secondTurn = vault.registerSecret('sess_1', 'admin@bank.com', 'EMAIL');

    expect(firstTurn).toBe('[EMAIL_1]');
    expect(secondTurn).toBe('[EMAIL_1]');
  });

  it('strictly isolates placeholders between independent sessions', () => {
    const p1 = vault.registerSecret('alice_chat', 'secret_key_1', 'HIGH_ENTROPY_SECRET');
    const p2 = vault.registerSecret('bob_chat', 'secret_key_2', 'HIGH_ENTROPY_SECRET');

    // Both should receive index 1 within their own session
    expect(p1).toBe('[HIGH_ENTROPY_SECRET_1]');
    expect(p2).toBe('[HIGH_ENTROPY_SECRET_1]');

    // Session resolution does not bleed
    expect(vault.resolvePlaceholder('alice_chat', '[HIGH_ENTROPY_SECRET_1]')).toBe('secret_key_1');
    expect(vault.resolvePlaceholder('bob_chat', '[HIGH_ENTROPY_SECRET_1]')).toBe('secret_key_2');
  });

  it('reversibly unmasks completions using session state', () => {
    vault.registerSecret('sess_1', '4532-0151-1283-0366', 'CREDIT_CARD');
    vault.registerSecret('sess_1', 'contact@corp.com', 'EMAIL');

    const completion = 'Card [CREDIT_CARD_1] was charged. Invoice sent to [EMAIL_1].';
    const unmasked = vault.unmask('sess_1', completion);

    expect(unmasked).toBe('Card 4532-0151-1283-0366 was charged. Invoice sent to contact@corp.com.');
  });

  it('purges session state on demand and tracks lifetime statistics', () => {
    vault.registerSecret('sess_1', 'key1', 'AWS_ACCESS_KEY');
    vault.registerSecret('sess_1', 'key2', 'AWS_ACCESS_KEY');

    let stats = vault.getStats();
    expect(stats.activeSessions).toBe(1);
    expect(stats.totalSecretsProtected).toBe(2);

    vault.purgeSession('sess_1');

    stats = vault.getStats();
    expect(stats.activeSessions).toBe(0);
    // Lifetime count preserved for telemetry
    expect(stats.totalSecretsProtected).toBe(2);
    expect(vault.resolvePlaceholder('sess_1', '[AWS_ACCESS_KEY_1]')).toBeUndefined();
  });

  it('automatically purges expired sessions via TTL', () => {
    vi.useFakeTimers();
    const shortVault = new SessionVault(2); // 2 second TTL

    shortVault.registerSecret('temp_session', 'my_token', 'GITHUB_TOKEN');
    expect(shortVault.getStats().activeSessions).toBe(1);

    // Fast forward 3 seconds
    vi.advanceTimersByTime(3000);

    expect(shortVault.getStats().activeSessions).toBe(0);
    expect(shortVault.resolvePlaceholder('temp_session', '[GITHUB_TOKEN_1]')).toBeUndefined();

    vi.useRealTimers();
  });
});

