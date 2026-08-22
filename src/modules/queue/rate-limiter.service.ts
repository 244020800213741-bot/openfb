import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Simple in-memory rate limiter for outbound messages.
 * Mirrors OpenWA's RATE_LIMIT_MESSAGES_PER_MIN configuration.
 *
 * In production this would use Redis (like OpenWA's ioredis adapter),
 * but for the initial release we keep it in-process.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly limits = new Map<string, RateLimitEntry>();
  private readonly maxPerMinute: number;

  constructor(config: ConfigService) {
    this.maxPerMinute = config.get<number>('RATE_LIMIT_MESSAGES_PER_MIN') ?? 60;
  }

  /**
   * Check if a message can be sent for the given session.
   * Returns true if allowed, false if rate-limited.
   */
  check(sessionId: string): boolean {
    const now = Date.now();
    const entry = this.limits.get(sessionId);

    if (!entry || now - entry.windowStart > 60_000) {
      this.limits.set(sessionId, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= this.maxPerMinute) {
      this.logger.warn(
        `Rate limit exceeded for session ${sessionId}: ${entry.count}/${this.maxPerMinute} per minute`,
      );
      return false;
    }

    entry.count++;
    return true;
  }

  getUsage(sessionId: string): { count: number; max: number; resetInMs: number } {
    const now = Date.now();
    const entry = this.limits.get(sessionId);
    if (!entry) return { count: 0, max: this.maxPerMinute, resetInMs: 0 };
    return {
      count: entry.count,
      max: this.maxPerMinute,
      resetInMs: Math.max(0, 60_000 - (now - entry.windowStart)),
    };
  }
}
