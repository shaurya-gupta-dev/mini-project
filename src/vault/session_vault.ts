/**
 * Ephemeral Session Vault
 * Zero-disk, in-memory state machine maintaining bidirectional placeholder mappings
 * across multi-turn LLM conversations with automated TTL expiration.
 */

import { EntityType } from '../engine/types.js';

export interface VaultEntry {
  placeholder: string;
  realValue: string;
  type: EntityType;
  createdAt: number;
}

export interface SessionRecord {
  sessionId: string;
  entriesByPlaceholder: Map<string, VaultEntry>;
  placeholderByRealValue: Map<string, string>;
  typeCounters: Map<EntityType, number>;
  createdAt: number;
  lastAccessedAt: number;
  timerId?: ReturnType<typeof setTimeout>;
}

export interface VaultStats {
  activeSessions: number;
  totalSecretsProtected: number;
  secretsByType: Record<string, number>;
}

export class SessionVault {
  private sessions = new Map<string, SessionRecord>();
  private defaultTtlMs: number;
  private totalLifetimeProtections = 0;
  private protectionsByType: Record<string, number> = {};

  constructor(ttlSeconds: number = 300) {
    this.defaultTtlMs = ttlSeconds * 1000;
  }

  /**
   * Retrieves or initializes a session record by ID.
   */
  public getOrCreateSession(sessionId: string): SessionRecord {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        sessionId,
        entriesByPlaceholder: new Map(),
        placeholderByRealValue: new Map(),
        typeCounters: new Map(),
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };

      this.scheduleExpiration(session);
      this.sessions.set(sessionId, session);
    } else {
      session.lastAccessedAt = Date.now();
      this.rescheduleExpiration(session);
    }

    return session;
  }

  /**
   * Registers a real value in the session, returning an existing placeholder if already
   * seen, or allocating a new deterministic placeholder.
   */
  public registerSecret(
    sessionId: string,
    realValue: string,
    type: EntityType
  ): string {
    const session = this.getOrCreateSession(sessionId);

    // If already known in this conversation, return existing placeholder
    const existing = session.placeholderByRealValue.get(realValue);
    if (existing) {
      return existing;
    }

    // Allocate next counter for this entity type in this session
    const currentCount = session.typeCounters.get(type) ?? 0;
    const nextCount = currentCount + 1;
    session.typeCounters.set(type, nextCount);

    const placeholder = `[${type}_${nextCount}]`;

    const entry: VaultEntry = {
      placeholder,
      realValue,
      type,
      createdAt: Date.now(),
    };

    session.entriesByPlaceholder.set(placeholder, entry);
    session.placeholderByRealValue.set(realValue, placeholder);

    // Track telemetry
    this.totalLifetimeProtections++;
    this.protectionsByType[type] = (this.protectionsByType[type] ?? 0) + 1;

    return placeholder;
  }

  /**
   * Checks whether a session has any registered secrets.
   */
  public hasActiveSecrets(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.entriesByPlaceholder.size > 0;
  }

  /**
   * Resolves a placeholder back to its real value.
   */
  public resolvePlaceholder(
    sessionId: string,
    placeholder: string
  ): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.lastAccessedAt = Date.now();
    this.rescheduleExpiration(session);

    return session.entriesByPlaceholder.get(placeholder)?.realValue;
  }

  /**
   * Exports all active placeholder-to-real-value mappings for a session.
   */
  public getSessionMap(sessionId: string): Record<string, string> {
    const session = this.sessions.get(sessionId);
    if (!session) return {};

    const map: Record<string, string> = {};
    for (const [placeholder, entry] of session.entriesByPlaceholder) {
      map[placeholder] = entry.realValue;
    }
    return map;
  }

  /**
   * Unmasks text for a given session by substituting all active placeholders in a single pass.
   */
  public unmask(sessionId: string, text: string): string {
    const session = this.sessions.get(sessionId);
    if (!session || !text.includes('[')) return text;

    return text.replace(/\[(?:[A-Z0-9_]+)_[0-9]+\]/g, (match) => {
      const entry = session.entriesByPlaceholder.get(match);
      return entry ? entry.realValue : match;
    });
  }

  /**
   * Manually terminates and purges a session immediately.
   */
  public purgeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.timerId) {
        clearTimeout(session.timerId);
      }
      session.entriesByPlaceholder.clear();
      session.placeholderByRealValue.clear();
      session.typeCounters.clear();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Returns current telemetry and stats.
   */
  public getStats(): VaultStats {
    return {
      activeSessions: this.sessions.size,
      totalSecretsProtected: this.totalLifetimeProtections,
      secretsByType: { ...this.protectionsByType },
    };
  }

  /**
   * Purges all sessions and resets vault state.
   */
  public clearAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.purgeSession(sessionId);
    }
    this.sessions.clear();
  }

  private scheduleExpiration(session: SessionRecord): void {
    session.timerId = setTimeout(() => {
      this.purgeSession(session.sessionId);
    }, this.defaultTtlMs);

    // Prevent Node process from keeping event loop active in server environments
    if (session.timerId && typeof session.timerId === 'object' && 'unref' in session.timerId) {
      (session.timerId as { unref: () => void }).unref();
    }
  }

  private rescheduleExpiration(session: SessionRecord): void {
    if (session.timerId) {
      clearTimeout(session.timerId);
    }
    this.scheduleExpiration(session);
  }
}

// Global default singleton instance
export const defaultSessionVault = new SessionVault();
