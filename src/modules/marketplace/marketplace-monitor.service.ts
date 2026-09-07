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

/** Common Spanish words that should not count for relevance matching. */
const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'o', 'u', 'en', 'para', 'por', 'con', 'sin', 'que', 'del',
  'al', 'lo', 'le', 'se', 'su', 'sus', 'es', 'son', 'the', 'and',
]);

/** Synonym groups: if the query contains any word from a group, the title
 *  matches if it contains ANY word from that same group (not just the exact
 *  query word). This handles e.g. "tarjeta de video" matching "placa de video"
 *  or "gpu", "tarjeta grafica", etc. */
const SYNONYM_GROUPS: string[][] = [
  // Graphics card / GPU
  ['tarjeta', 'placa', 'grafica', 'gráfica', 'grafica', 'video', 'gpu',
   'rx', 'rtx', 'gtx', 'geforce', 'radeon', 'nvidia', 'amd', 'arc',
   'aorus', 'gigabyte', 'asus', 'msi', 'evga', 'zotac', 'pny',
   '3060', '3070', '3080', '3090', '4060', '4070', '4080', '4090',
   '6600', '6700', '6800', '6900', '7500', '7600', '7700', '7800', '7900'],
  // Phone / smartphone
  ['celular', 'telefono', 'teléfono', 'phone', 'smartphone', 'iphone',
   'samsung', 'xiaomi', 'motorola', 'moto', 'huawei', 'oneplus', 'pixel'],
  // Laptop / notebook
  ['laptop', 'notebook', 'portatil', 'portátil', 'computadora', 'pc',
   'desktop', 'torre', 'cpu', 'gamer'],
];

/** Build a lookup: word → set of all synonyms across all groups. */
const SYNONYM_MAP = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    const normalized = normalize(word);
    if (!SYNONYM_MAP.has(normalized)) {
      SYNONYM_MAP.set(normalized, new Set<string>());
    }
    const set = SYNONYM_MAP.get(normalized)!;
    for (const other of group) {
      set.add(normalize(other));
    }
  }
}

/** Normalize text: lowercase + strip accents. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
    .replace(/ó/g, 'o').replace(/ú/g, 'u');
}

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

    // Run the first search — wait for authentication first.
    // The session may be in 'waiting_for_login' if the user hasn't completed
    // Facebook's verification yet. We poll until authenticated, then search.
    this.waitForAuthAndSearch(sessionId).catch((err) => {
      this.logger.error(`Monitor ${sessionId} initial search failed: ${err.message}`);
    });
  }

  /**
   * Wait for the session to become authenticated, then run the first search.
   * Polls the session state every 5 seconds for up to 30 minutes.
   */
  private async waitForAuthAndSearch(sessionId: string): Promise<void> {
    const monitor = this.monitors.get(sessionId);
    if (!monitor) return;

    for (let i = 0; i < 360; i++) {
      // 30 min max
      if (!this.monitors.has(sessionId)) return; // monitor was unregistered
      if (monitor.session.state === 'authenticated') {
        await this.runSearch(sessionId);
        return;
      }
      if (monitor.session.state === 'disconnected' || monitor.session.state === 'error') {
        this.logger.warn(`Monitor ${sessionId} aborted: session state is ${monitor.session.state}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    this.logger.warn(`Monitor ${sessionId} timed out waiting for authentication after 30 minutes`);
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

    // Skip if session is not authenticated yet (will retry on next tick)
    if (session.state !== 'authenticated') {
      this.logger.log(`Skipping search for session ${sessionId}: state is ${session.state}`);
      return;
    }

    this.logger.log(
      `Running marketplace search for session ${sessionId}: query="${config.query}", ` +
        `minPrice=${config.minPrice ?? '-'}, maxPrice=${config.maxPrice ?? '-'}, ` +
        `location=${config.location ?? '-'}, interval=${config.intervalMinutes}min, ` +
        `emailTo=${config.emailTo ?? '(default)'}`,
    );

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

    // Safety net: enforce price filters client-side. Facebook's Marketplace
    // price filter is unreliable — it sometimes ignores the filled-in value or
    // returns results before the filter takes effect. Strip out anything that
    // violates the requested range so the email never shows out-of-range items.
    const beforePriceFilter = result.listings.length;
    if (config.minPrice !== undefined || config.maxPrice !== undefined) {
      result.listings = result.listings.filter((l) => {
        if (l.price <= 0) return true; // keep if price unknown/unparseable
        if (config.minPrice !== undefined && l.price < config.minPrice) return false;
        if (config.maxPrice !== undefined && l.price > config.maxPrice) return false;
        return true;
      });
      if (result.listings.length < beforePriceFilter) {
        this.logger.log(
          `Price filter removed ${beforePriceFilter - result.listings.length} listing(s) ` +
            `outside [${config.minPrice ?? '-∞'}, ${config.maxPrice ?? '+∞'}] for session ${sessionId}`,
        );
      }
    }

    // Filter out listings priced in foreign currency (dlls, dólares, USD, etc.)
    // The user searches in Argentine pesos; listings in USD are always way over
    // budget and should never be sent.
    const foreignCurrencyPattern = /\b(dlls|dolare?s|d[oó]llare?s|us\$|u\$s|usd|dollars?)\b/i;
    const beforeCurrencyFilter = result.listings.length;
    result.listings = result.listings.filter((l) => {
      const text = `${l.title} ${l.location}`;
      if (foreignCurrencyPattern.test(text)) return false;
      return true;
    });
    if (result.listings.length < beforeCurrencyFilter) {
      this.logger.log(
        `Currency keyword filter removed ${beforeCurrencyFilter - result.listings.length} listing(s) ` +
          `for session ${sessionId}`,
      );
    }

    // Relevance filter: keep only listings whose title contains at least one
    // meaningful word from the search query (or a synonym of it). Facebook's
    // Marketplace search is fuzzy and returns "related" items (e.g. cameras
    // when you search for "tarjeta de video"). This strips out results that
    // don't match at all, while still allowing synonyms like "placa" or "gpu".
    const queryWords = config.query
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
    if (queryWords.length > 0) {
      // For each query word, collect all acceptable match words (itself + synonyms)
      const acceptableWords = new Set<string>();
      for (const w of queryWords) {
        const nw = normalize(w);
        acceptableWords.add(nw);
        const syns = SYNONYM_MAP.get(nw);
        if (syns) {
          for (const s of syns) acceptableWords.add(s);
        }
      }
      const beforeRelevanceFilter = result.listings.length;
      result.listings = result.listings.filter((l) => {
        const normalizedTitle = normalize(l.title);
        // Match if any acceptable word appears in the title
        for (const word of acceptableWords) {
          if (normalizedTitle.includes(word)) return true;
        }
        return false;
      });
      if (result.listings.length < beforeRelevanceFilter) {
        this.logger.log(
          `Relevance filter removed ${beforeRelevanceFilter - result.listings.length} listing(s) ` +
            `not matching query words [${queryWords.join(', ')}] for session ${sessionId}`,
        );
      }
    }

    // Filter out previously-seen listings. Cap the seen set at 200 entries —
    // when it fills up, clear it so new searches can re-send active listings
    // instead of silently dropping everything after a few emails.
    const seen = this.seenListingIds.get(sessionId) || new Set<string>();
    if (seen.size >= 200) {
      this.logger.log(`Seen-list full (200) for session ${sessionId} — clearing to allow fresh results`);
      seen.clear();
    }
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

    // Send email — but only if configured. If not, log results to console
    // so the monitor still works (useful for testing without email setup).
    if (!this.emailService.isConfigured) {
      this.logger.warn(
        `Email not configured — logging ${toSend.length} results to console instead. ` +
          `Set GMAIL_USER and GMAIL_APP_PASSWORD in .env to receive email alerts.`,
      );
      for (const listing of toSend) {
        const price = listing.price ? `${listing.currency} ${listing.price}` : 'N/A';
        const location = listing.location ? ` · 📍 ${listing.location}` : '';
        this.logger.log(
          `  → ${listing.title} — ${price}${location} — ${listing.listingUrl}`,
        );
      }
      monitor.totalEmailsSent += 1;
      this.logger.log(
        `Processed ${toSend.length} new listings for session ${sessionId} (email not configured, logged to console)`,
      );
      return;
    }

    const recipient = config.emailTo || '';
    this.logger.log(
      `Sending ${toSend.length} listing(s) to "${recipient}" (from ${this.emailService.constructor.name}) for session ${sessionId}`,
    );
    try {
      await this.emailService.sendMarketplaceResults(
        recipient,
        config.query,
        toSend,
        result.searchUrl,
      );
      monitor.totalEmailsSent += 1;
      this.logger.log(
        `Sent ${toSend.length} new listings via email to ${recipient} for session ${sessionId} ` +
          `(total emails: ${monitor.totalEmailsSent})`,
      );
    } catch (err) {
      this.logger.error(
        `Email send FAILED for session ${sessionId} → recipient "${recipient}": ${(err as Error).message}`,
      );
      // Re-throw so the interval catch logs it too
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Stopping all marketplace monitors...');
    for (const [id] of this.monitors) {
      this.unregister(id);
    }
  }
}
