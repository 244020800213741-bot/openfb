import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type {
  MarketplaceSearchResult,
  MarketplaceSearchFilters,
  MarketplaceSort,
  MarketplaceCondition,
  MarketplaceMonitorConfig,
} from './marketplace.types';
import type { FacebookSession } from '../../engine/interfaces/engine.interface';
import { EmailService } from '../email/email.service';

interface ActiveMonitor {
  sessionId: string;
  session: FacebookSession;
  config: MarketplaceMonitorConfig;
  timer: NodeJS.Timeout;
  lastRunAt: Date | null;
  nextRunAt: Date;
  totalEmailsSent: number;
  lastResultCount: number;
}

/**
 * Manages scheduled marketplace searches.
 *
 * Each marketplace session registers a monitor config that specifies:
 *   - Search filters (query, price range, location, condition, etc.)
 *   - Interval (how often to search, in minutes)
 *   - Max results per email
 *
 * On each interval tick, the service:
 *   1. Runs a marketplace search on the session's browser
 *   2. Filters results to only new listings (not previously sent)
 *   3. Sends an email with the results via Gmail
 */
@Injectable()
export class MarketplaceMonitorService implements OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceMonitorService.name);
  private readonly monitors = new Map<string, ActiveMonitor>();
  /** Track previously-seen listing IDs per session to avoid duplicate emails */
  private readonly seenListingIds = new Map<string, Set<string>>();

  constructor(private readonly emailService: EmailService) {}

  /**
   * Register a marketplace monitor for a session.
   * The first search runs immediately, then on the configured interval.
   */
  register(sessionId: string, session: FacebookSession, config: MarketplaceMonitorConfig): void {
    // Unregister existing monitor for this session if present
    this.unregister(sessionId);

    const intervalMs = config.intervalMinutes * 60 * 1000;
    const nextRunAt = new Date(Date.now() + intervalMs);

    const timer = setInterval(() => {
      this.runSearch(sessionId).catch((err) => {
        this.logger.error(`Monitor ${sessionId} search failed: ${err.message}`);
      });
    }, intervalMs);

    this.monitors.set(sessionId, {
      sessionId,
      session,
      config,
      timer,
      lastRunAt: null,
      nextRunAt,
      totalEmailsSent: 0,
      lastResultCount: 0,
    });

    this.seenListingIds.set(sessionId, new Set());

    this.logger.log(
      `Monitor registered for session ${sessionId}: query="${config.query}", ` +
        `every ${config.intervalMinutes}min, max ${config.maxResults} results per email`,
    );

    // Run the first search immediately
    this.runSearch(sessionId).catch((err) => {
      this.logger.error(`Monitor ${sessionId} initial search failed: ${err.message}`);
    });
  }

  /**
   * Stop and remove a monitor for a session.
   */
  unregister(sessionId: string): void {
    const monitor = this.monitors.get(sessionId);
    if (monitor) {
      clearInterval(monitor.timer);
      this.monitors.delete(sessionId);
      this.logger.log(`Monitor unregistered for session ${sessionId}`);
    }
    this.seenListingIds.delete(sessionId);
  }

  /**
   * Get monitor status for a session.
   */
  getStatus(sessionId: string): ActiveMonitor | undefined {
    return this.monitors.get(sessionId);
  }

  /**
   * Run a single marketplace search and send results via email.
   */
  private async runSearch(sessionId: string): Promise<void> {
    const monitor = this.monitors.get(sessionId);
    if (!monitor) return;

    const { session, config } = monitor;

    this.logger.log(`Running marketplace search for session ${sessionId}: "${config.query}"`);

    // Build the search filters from the monitor config
    const filters: MarketplaceSearchFilters = {
      query: config.query,
      location: config.location,
      radiusKm: config.radiusKm,
      minPrice: config.minPrice,
      maxPrice: config.maxPrice,
      sortBy: config.sortBy as MarketplaceSort | undefined,
      condition: config.condition as MarketplaceCondition[] | undefined,
      postedAfter: config.postedAfter ? new Date(config.postedAfter) : undefined,
      itemType: config.itemType as any,
      limit: 50, // Fetch more than needed, then filter new ones
    };

    const result: MarketplaceSearchResult = await session.searchMarketplace(filters);

    // Filter out previously-seen listings
    const seen = this.seenListingIds.get(sessionId) || new Set<string>();
    const newListings = result.listings.filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
    this.seenListingIds.set(sessionId, seen);

    monitor.lastRunAt = new Date();
    monitor.lastResultCount = newListings.length;
    monitor.nextRunAt = new Date(Date.now() + config.intervalMinutes * 60 * 1000);

    if (newListings.length === 0) {
      this.logger.log(`No new listings for session ${sessionId}. Total found: ${result.listings.length}`);
      return;
    }

    // Limit to maxResults
    const toSend = newListings.slice(0, config.maxResults);

    // Send email
    const recipient = config.emailTo || '';
    await this.emailService.sendMarketplaceResults(
      recipient,
      config.query,
      toSend,
      result.searchUrl,
    );

    monitor.totalEmailsSent += 1;
    this.logger.log(
      `Sent ${toSend.length} new listings via email for session ${sessionId} ` +
        `(total emails: ${monitor.totalEmailsSent})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Stopping all marketplace monitors...');
    for (const [id] of this.monitors) {
      this.unregister(id);
    }
  }
}
