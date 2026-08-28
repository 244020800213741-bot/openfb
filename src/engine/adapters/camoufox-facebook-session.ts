import { EventEmitter } from 'events';
import * as path from 'path';
import { firefox, Browser, BrowserContext, Page } from 'playwright';
import { CamoufoxProcessManager } from './camoufox-process-manager';
import {
  FacebookSession,
  SessionState,
  SendMessageResult,
  MediaInput,
  ConversationSummary,
  FacebookMessage,
  FacebookContact,
  SearchType,
  SearchResult,
} from '../interfaces/engine.interface';
import type {
  MarketplaceSearchFilters,
  MarketplaceSearchResult,
  MarketplaceListing,
  MarketplaceSort,
} from '../../modules/marketplace/marketplace.types';

/**
 * Facebook Messenger automation via Camoufox + Playwright.
 *
 * This is the OpenFB equivalent of OpenWA's wwebjs/baileys adapter — but
 * instead of Puppeteer or a WebSocket library, it drives a stealth Firefox
 * (Camoufox) through Playwright's remote-connect API.
 *
 * Key selectors are centralised here so they survive Facebook UI changes.
 * The page-interaction logic mirrors how a human would use messenger.com:
 *   navigate → wait for chat list → click conversation → type → send.
 */
const FB_SELECTORS = {
  // Navigation
  chatList: 'div[role="navigation"] a[href*="/t/"]',
  chatListItem: 'a[href*="/t/"]',
  searchBox: 'input[placeholder*="Search" i], input[aria-label*="Search" i]',

  // Conversation view
  messageInput: 'div[contenteditable="true"][role="textbox"]',
  messageContainer: 'div[role="main"]',
  messageBubble: 'div[role="main"] div[style*="align-items"]',
  messageText: 'div[dir="auto"] span',

  // Chat header / contact info
  chatHeader: 'div[role="main"] h1 span, div[role="main"] span[dir="auto"]',
  contactName: 'span[dir="auto"] a, h1 span',

  // Misc
  sendButton: 'div[role="button"][aria-label*="Send" i]',
  unreadBadge: 'span:not(:empty)[class*="unread" i]',
};

// ─────────────────────────────────────────────
//  Marketplace selectors
// ─────────────────────────────────────────────
const MKT_SELECTORS = {
  // Search results — each listing card
  listingCard: 'a[href*="/marketplace/item/"]',
  listingImage: 'img',
  listingTitle: 'span[dir="auto"]',
  listingPrice: 'span[dir="auto"]', // price appears as a span with currency formatting

  // Filters sidebar
  filterLocationInput: 'input[aria-label*="ocation" i]',
  filterRadiusSelect: 'select[aria-label*="adius" i], select[aria-label*="istance" i]',
  filterMinPrice: 'input[aria-label*="in" i][aria-label*="price" i], input[placeholder*="Min" i]',
  filterMaxPrice: 'input[aria-label*="ax" i][aria-label*="price" i], input[placeholder*="Max" i]',
  filterSortDropdown: 'select[aria-label*="ort" i]',
  filterConditionNew: 'input[type="checkbox"][aria-label*="ew" i]',
  filterConditionUsed: 'input[type="checkbox"][aria-label*="sed" i]',
  filterApplyButton: 'div[role="button"]:has-text("Apply"), button:has-text("Apply")',

  // Item detail page
  itemDetailTitle: 'h1 span, div[data-testid="marketplace_pdp_title"]',
  itemDetailPrice: 'div[data-testid="marketplace_pdp_price"]',
  itemDetailLocation: 'div[data-testid="marketplace_pdp_location"]',
  itemDetailCondition: 'div[data-testid="marketplace_pdp_condition"]',
  itemDetailSeller: 'a[href*="/user/"] span, a[href*="/profile.php"] span',
  itemDetailImage: 'img[src*="scontent"]',
};

const MARKETPLACE_URL = 'https://www.facebook.com/marketplace/';

const MESSENGER_URL = 'https://www.messenger.com/';

export class CamoufoxFacebookSession extends EventEmitter implements FacebookSession {
  id: string;
  label: string;
  state: SessionState = 'initializing';
  createdAt: Date;
  lastActivityAt: Date;
  wsEndpoint: string;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private processManager: CamoufoxProcessManager;
  private listening = false;
  private lastMessageCount = 0;

  constructor(id: string, label: string, processManager: CamoufoxProcessManager, wsEndpoint: string) {
    super();
    this.id = id;
    this.label = label;
    this.createdAt = new Date();
    this.lastActivityAt = new Date();
    this.processManager = processManager;
    this.wsEndpoint = wsEndpoint;
  }

  // ──────────────────────────────────────────────
  //  Connection lifecycle
  // ──────────────────────────────────────────────

  async connect(storageStatePath?: string): Promise<void> {
    try {
      // Connect to the Camoufox remote server via Playwright WebSocket.
      // Camoufox exposes a Playwright-compatible WS endpoint (like
      // `ws://localhost:PORT/PATH`), so we use firefox.connect() — NOT
      // connectOverCDP (which is Chromium-only).
      this.browser = await firefox.connect(this.wsEndpoint, {
        timeout: 30_000,
      });

      // Camoufox server provides a browser with one context
      const contexts = this.browser.contexts();
      this.context = contexts[0] ?? (await this.browser.newContext());

      // If we have a saved storage state (cookies from shared login),
      // load it into the browser context BEFORE navigating.
      if (storageStatePath) {
        try {
          const fs = await import('fs');
          if (fs.existsSync(storageStatePath)) {
            const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
            if (state.cookies && state.cookies.length > 0) {
              await this.context.addCookies(state.cookies);
              console.log(`[CamoufoxFacebookSession] Loaded ${state.cookies.length} cookies from shared login`);
            }
          }
        } catch (err) {
          console.warn(`[CamoufoxFacebookSession] Failed to load storage state: ${(err as Error).message}`);
        }
      }

      // Use existing page or create one
      const pages = this.context.pages();
      this.page = pages[0] ?? (await this.context.newPage());

      // Set a realistic viewport
      await this.page.setViewportSize({ width: 1280, height: 800 });

      // Navigate to Facebook first (not Messenger). The shared login saves
      // cookies for facebook.com, and Messenger requires facebook.com cookies
      // to authenticate. Going to facebook.com first ensures the session
      // cookies are recognised, then we can redirect to Messenger.
      await this.page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });

      // Wait a moment for potential redirects
      await this.page.waitForTimeout(3000);

      // Check if we're logged in
      const isLoggedIn = await this.checkLoggedIn();
      if (!isLoggedIn) {
        this.setState('waiting_for_login');
        // Start polling for login completion in the background.
        // This handles the case where the user completes Facebook's
        // verification (2FA, checkpoint, etc.) after the session starts.
        this.pollForLogin().catch(() => {
          // Login polling errors are non-fatal; the state stays 'waiting_for_login'
        });
      } else {
        this.setState('authenticated');
      }

      this.lastActivityAt = new Date();
    } catch (err) {
      this.setState('error');
      throw new Error(`Failed to connect Camoufox session: ${(err as Error).message}`);
    }
  }

  /**
   * Poll in the background for login completion.
   * Checks every 5 seconds for up to 30 minutes.
   * Emits 'state_change' → 'authenticated' when login is detected.
   */
  private async pollForLogin(): Promise<void> {
    console.log('[CamoufoxFacebookSession] Starting login polling (checks every 5s for up to 30 min)');
    for (let i = 0; i < 360; i++) {
      // 30 minutes max, 5s interval
      await new Promise((r) => setTimeout(r, 5000));
      if (this.state === 'disconnected' || this.state === 'error') {
        console.log('[CamoufoxFacebookSession] Login polling stopped — session disconnected/error');
        return;
      }
      if (this.state === 'authenticated') {
        console.log('[CamoufoxFacebookSession] Login polling stopped — already authenticated');
        return;
      }
      try {
        const isLoggedIn = await this.checkLoggedIn();
        if (isLoggedIn) {
          console.log(`[CamoufoxFacebookSession] ✓✓✓ LOGIN DETECTED after ${(i + 1) * 5}s — transitioning to authenticated`);
          this.setState('authenticated');
          this.lastActivityAt = new Date();
          return;
        }
      } catch (err) {
        console.log(`[CamoufoxFacebookSession] Login poll check error (non-fatal): ${(err as Error).message}`);
      }
    }
    console.log('[CamoufoxFacebookSession] Login polling timed out after 30 minutes');
  }

  /**
   * Manually re-check whether the session is now authenticated.
   * Useful when the user completed Facebook verification after the
   * session was created. Returns the current state.
   */
  async checkAuth(): Promise<SessionState> {
    if (!this.page) return this.state;
    // If already authenticated, nothing to do
    if (this.state === 'authenticated') return this.state;
    // Only re-check if we're waiting for login (not disconnected/error)
    if (this.state !== 'waiting_for_login') return this.state;

    try {
      // Navigate to Facebook to see if login redirect is gone
      const url = this.page.url();
      if (!url.includes('facebook.com') && !url.includes('messenger.com')) {
        await this.page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(3000);
      }
      const isLoggedIn = await this.checkLoggedIn();
      if (isLoggedIn) {
        this.setState('authenticated');
        this.lastActivityAt = new Date();
      }
    } catch {
      // ignore — stay in current state
    }
    return this.state;
  }

  private async checkLoggedIn(): Promise<boolean> {
    if (!this.page) return false;
    const url = this.page.url();
    console.log(`[CamoufoxFacebookSession] checkLoggedIn() — current URL: ${url}`);

    // If we're on a login or checkpoint page, definitely not logged in
    if (url.includes('login') || url.includes('checkpoint')) {
      console.log('[CamoufoxFacebookSession] Not logged in — on login/checkpoint page');
      return false;
    }

    // Check for Facebook session cookies — c_user and xs are ONLY set
    // after a genuine login. DOM selectors are unreliable because the
    // facebook.com login page renders many of the same selectors we
    // previously relied on (div[role="navigation"], a[aria-label="Facebook"],
    // etc.), which caused false positives.
    try {
      const cookies = await this.page.context().cookies();
      const hasCUser = cookies.some((c) => c.name === 'c_user');
      const hasXs = cookies.some((c) => c.name === 'xs');
      if (hasCUser && hasXs) {
        console.log('[CamoufoxFacebookSession] ✓ Logged in detected (cookies: c_user + xs)');
        return true;
      }
    } catch {
      // fall through to selector fallback
    }

    console.log('[CamoufoxFacebookSession] Not logged in — no session cookies (c_user/xs) found');
    return false;
  }

  /**
   * Take a screenshot and return it as base64 (for QR/login status display).
   */
  async getScreenshot(): Promise<string> {
    if (!this.page) return '';
    const buffer = await this.page.screenshot({ type: 'png' });
    return buffer.toString('base64');
  }

  // ──────────────────────────────────────────────
  //  Messaging
  // ──────────────────────────────────────────────

  async sendText(chatId: string, text: string): Promise<SendMessageResult> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    try {
      // Navigate to the conversation
      const chatUrl = `https://www.messenger.com/t/${chatId}`;
      await this.page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForSelector(FB_SELECTORS.messageInput, { timeout: 10000 });

      // Type the message (human-like, with small delays)
      const input = this.page.locator(FB_SELECTORS.messageInput).first();
      await input.click();
      await this.page.keyboard.type(text, { delay: 30 });

      // Press Enter to send
      await this.page.keyboard.press('Enter');

      await this.page.waitForTimeout(500);

      this.lastActivityAt = new Date();
      return {
        success: true,
        messageId: `msg_${Date.now()}`,
        chatId,
        timestamp: new Date(),
      };
    } catch (err) {
      return {
        success: false,
        chatId,
        timestamp: new Date(),
        error: (err as Error).message,
      };
    }
  }

  async sendMedia(chatId: string, media: MediaInput): Promise<SendMessageResult> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    try {
      const chatUrl = `https://www.messenger.com/t/${chatId}`;
      await this.page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForSelector(FB_SELECTORS.messageInput, { timeout: 10000 });

      // Find the file input (Messenger uses a hidden file input for media uploads)
      const fileInput = this.page.locator('input[type="file"]').first();

      if (media.data.startsWith('http')) {
        // Download the file first, then upload
        // For simplicity, we use the file input directly if it's a path
        await fileInput.setInputFiles(media.data);
      } else if (media.data.startsWith('/')) {
        await fileInput.setInputFiles(media.data);
      } else {
        // Base64 — write to a temp file, then upload
        const fs = await import('fs');
        const os = await import('os');
        const tmpPath = path.join(os.tmpdir(), media.filename || `openfb_media_${Date.now()}`);
        fs.writeFileSync(tmpPath, Buffer.from(media.data, 'base64'));
        await fileInput.setInputFiles(tmpPath);
        // Clean up after upload
        setTimeout(() => fs.unlinkSync(tmpPath), 5000);
      }

      // If there's a caption, type it
      if (media.caption) {
        const input = this.page.locator(FB_SELECTORS.messageInput).first();
        await input.click();
        await this.page.keyboard.type(media.caption, { delay: 30 });
      }

      // Send (press Enter or click send)
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(1000);

      this.lastActivityAt = new Date();
      return {
        success: true,
        messageId: `msg_${Date.now()}`,
        chatId,
        timestamp: new Date(),
      };
    } catch (err) {
      return {
        success: false,
        chatId,
        timestamp: new Date(),
        error: (err as Error).message,
      };
    }
  }

  // ──────────────────────────────────────────────
  //  Conversation & contact info
  // ──────────────────────────────────────────────

  async getConversations(limit = 50): Promise<ConversationSummary[]> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    try {
      // Ensure we're on the Messenger main page
      if (!this.page.url().includes('messenger.com') || this.page.url().includes('/t/')) {
        await this.page.goto(MESSENGER_URL, { waitUntil: 'domcontentloaded' });
        await this.page.waitForSelector(FB_SELECTORS.chatListItem, { timeout: 10000 });
      }

      const items = await this.page.locator(FB_SELECTORS.chatListItem).all();

      const conversations: ConversationSummary[] = [];
      const count = Math.min(items.length, limit);

      for (let i = 0; i < count; i++) {
        const item = items[i];
        const href = (await item.getAttribute('href')) || '';
        const chatId = this.extractChatId(href);
        const name = (await item.textContent())?.trim() || 'Unknown';
        const avatarImg = item.locator('img').first();
        const avatarUrl = (await avatarImg.getAttribute('src')) || undefined;

        conversations.push({
          id: chatId,
          name,
          avatarUrl,
          unreadCount: 0,
          isGroup: false, // Determined by additional selectors
          participantsCount: 2,
        });
      }

      this.lastActivityAt = new Date();
      return conversations;
    } catch (err) {
      throw new Error(`Failed to get conversations: ${(err as Error).message}`);
    }
  }

  async getMessages(chatId: string, limit = 50): Promise<FacebookMessage[]> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    try {
      const chatUrl = `https://www.messenger.com/t/${chatId}`;
      await this.page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForSelector(FB_SELECTORS.messageContainer, { timeout: 10000 });

      // Scroll up to load more messages
      await this.page.evaluate(() => {
        const container = document.querySelector('div[role="main"]');
        if (container) container.scrollTop = 0;
      });
      await this.page.waitForTimeout(1000);

      // Extract messages from the DOM
      const messages = await this.page.evaluate(
        ([selector, limitVal]) => {
          const bubbles = document.querySelectorAll(selector);
          const results: Array<{
            text: string;
            sender: string;
            isOutbound: boolean;
            timestamp: string;
          }> = [];

          const elements = Array.from(bubbles).slice(-limitVal);
          for (const bubble of elements) {
            const textEl = bubble.querySelector('span[dir="auto"]');
            const text = textEl?.textContent?.trim() || '';
            if (!text) continue;

            // Heuristic: messages on the right side are outbound
            const style = window.getComputedStyle(bubble);
            const alignSelf = style.getPropertyValue('align-self');
            const isOutbound = alignSelf === 'flex-end';

            results.push({
              text,
              sender: isOutbound ? 'me' : 'them',
              isOutbound,
              timestamp: new Date().toISOString(),
            });
          }
          return results;
        },
        [FB_SELECTORS.messageBubble, limit] as const,
      );

      return messages.map((m, i) => ({
        id: `msg_${chatId}_${i}`,
        chatId,
        senderId: m.isOutbound ? 'me' : chatId,
        senderName: m.sender,
        text: m.text,
        timestamp: new Date(m.timestamp),
        direction: (m.isOutbound ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
      }));
    } catch (err) {
      throw new Error(`Failed to get messages: ${(err as Error).message}`);
    }
  }

  async getContact(contactId: string): Promise<FacebookContact | null> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    try {
      const chatUrl = `https://www.messenger.com/t/${contactId}`;
      await this.page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);

      // Try to extract the contact name from the chat header
      const nameEl = this.page.locator(FB_SELECTORS.chatHeader).first();
      const name = (await nameEl.textContent())?.trim() || 'Unknown';

      return {
        id: contactId,
        name,
        type: 'user',
      };
    } catch {
      return null;
    }
  }

  async search(query: string, type: SearchType = 'conversations'): Promise<SearchResult[]> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    try {
      await this.page.goto(MESSENGER_URL, { waitUntil: 'domcontentloaded' });
      await this.page.waitForSelector(FB_SELECTORS.searchBox, { timeout: 10000 });

      const searchBox = this.page.locator(FB_SELECTORS.searchBox).first();
      await searchBox.click();
      await this.page.keyboard.type(query, { delay: 50 });
      await this.page.waitForTimeout(2000);

      // Get search results
      const results = await this.page.locator('a[href*="/t/"], a[href*="/messages"]').all();
      const searchResults: SearchResult[] = [];

      for (const result of results.slice(0, 20)) {
        const name = (await result.textContent())?.trim() || '';
        const href = (await result.getAttribute('href')) || '';
        const id = this.extractChatId(href);
        if (name && id) {
          searchResults.push({ type, id, name });
        }
      }

      return searchResults;
    } catch (err) {
      throw new Error(`Search failed: ${(err as Error).message}`);
    }
  }

  // ──────────────────────────────────────────────
  //  Marketplace search with filters
  // ──────────────────────────────────────────────

  async searchMarketplace(filters: MarketplaceSearchFilters): Promise<MarketplaceSearchResult> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    const limit = filters.limit ?? 24;

    // If we have a location name but no coordinates, geocode it first.
    // Facebook Marketplace search requires lat/lng for location-based results.
    if (filters.location && !filters.latitude && !filters.longitude) {
      const coords = await this.geocodeLocation(filters.location);
      if (coords) {
        filters = { ...filters, ...coords };
      }
    }

    const searchUrl = this.buildMarketplaceSearchUrl(filters);

    try {
      // Navigate to Marketplace search
      console.log(`[CamoufoxFacebookSession] Navigating to: ${searchUrl}`);
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);

      // Log the final URL after redirects (Facebook may redirect to a
      // location-specific page)
      console.log(`[CamoufoxFacebookSession] After navigation, URL is: ${this.page.url()}`);

      // Apply filters that can't be set via URL params (price, radius, condition)
      await this.applyMarketplaceFilters(filters);

      // Wait for listing cards to load
      await this.page.waitForSelector(MKT_SELECTORS.listingCard, { timeout: 15000 });

      // Scroll to load more results if needed
      await this.scrollMarketplaceResults(limit);

      // Extract listings from DOM
      const listings = await this.extractMarketplaceListings(limit);

      // Filter by postedAfter if specified
      const filtered = filters.postedAfter
        ? listings.filter((l) => !l.postedDate || l.postedDate >= filters.postedAfter!)
        : listings;

      this.lastActivityAt = new Date();

      console.log(`[CamoufoxFacebookSession] Marketplace search returned ${filtered.length} listings (of ${listings.length} total)`);

      return {
        listings: filtered,
        totalFound: filtered.length,
        filters,
        searchUrl,
        timestamp: new Date(),
        hasMore: listings.length >= limit,
      };
    } catch (err) {
      throw new Error(`Marketplace search failed: ${(err as Error).message}`);
    }
  }

  async getMarketplaceListing(listingId: string): Promise<MarketplaceListing | null> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    try {
      const itemUrl = `https://www.facebook.com/marketplace/item/${listingId}/`;
      await this.page.goto(itemUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);

      // Extract listing details from the PDP (product detail page)
      const titleEl = this.page.locator(MKT_SELECTORS.itemDetailTitle).first();
      const priceEl = this.page.locator(MKT_SELECTORS.itemDetailPrice).first();
      const locationEl = this.page.locator(MKT_SELECTORS.itemDetailLocation).first();
      const conditionEl = this.page.locator(MKT_SELECTORS.itemDetailCondition).first();
      const sellerEl = this.page.locator(MKT_SELECTORS.itemDetailSeller).first();
      const imageEl = this.page.locator(MKT_SELECTORS.itemDetailImage).first();

      const [title, priceText, location, conditionText, sellerName, imageUrl] = await Promise.all([
        titleEl.textContent().catch(() => ''),
        priceEl.textContent().catch(() => ''),
        locationEl.textContent().catch(() => ''),
        conditionEl.textContent().catch(() => ''),
        sellerEl.textContent().catch(() => ''),
        imageEl.getAttribute('src').catch(() => undefined),
      ]);

      if (!title?.trim()) return null;

      const { price, currency } = this.parsePrice(priceText || '');

      return {
        id: listingId,
        title: title.trim(),
        price,
        currency,
        location: location?.trim() || '',
        imageUrl: imageUrl || undefined,
        listingUrl: itemUrl,
        sellerName: sellerName?.trim() || undefined,
        postedDate: undefined,
        condition: this.parseCondition(conditionText || ''),
        isAvailable: true,
      };
    } catch (err) {
      this.emit('error', err);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  //  Marketplace helpers
  // ──────────────────────────────────────────────

  private buildMarketplaceSearchUrl(filters: MarketplaceSearchFilters): string {
    const params = new URLSearchParams();
    params.set('query', filters.query);

    // Facebook Marketplace requires latitude/longitude for location-based
    // search. If we have them, include them in the URL so results are
    // geographically relevant from the first page load.
    if (filters.latitude && filters.longitude) {
      params.set('latitude', String(filters.latitude));
      params.set('longitude', String(filters.longitude));
      console.log(`[CamoufoxFacebookSession] Market URL uses coordinates: ${filters.latitude}, ${filters.longitude}`);
    } else if (filters.location) {
      console.log(`[CamoufoxFacebookSession] Market URL has location text "${filters.location}" but no coordinates — will try UI filter`);
    } else {
      console.log('[CamoufoxFacebookSession] Market URL has no location — Facebook will use IP-based location');
    }

    // Sort maps to the `sortBy` URL param on Facebook
    const sortMap: Record<MarketplaceSort, string> = {
      relevance: 'creation_time_descend',
      price_asc: 'price_ascend',
      price_desc: 'price_descend',
      newest: 'creation_time_descend',
      nearest: 'distance_ascend',
    };
    if (filters.sortBy) {
      params.set('sortBy', sortMap[filters.sortBy] || sortMap.relevance);
    }

    if (filters.itemType && filters.itemType !== 'all') {
      params.set('contentType', filters.itemType);
    }

    // Date filter — Facebook uses `daysSinceListed` param
    if (filters.postedAfter) {
      const daysAgo = Math.floor((Date.now() - filters.postedAfter.getTime()) / 86_400_000);
      if (daysAgo <= 1) params.set('daysSinceListed', '1');
      else if (daysAgo <= 7) params.set('daysSinceListed', '7');
      else if (daysAgo <= 30) params.set('daysSinceListed', '30');
    }

    return `${MARKETPLACE_URL}search/?${params.toString()}`;
  }

  /**
   * Geocode a location name to latitude/longitude using OpenStreetMap
   * Nominatim (free, no API key needed). Returns null if geocoding fails.
   */
  private async geocodeLocation(locationName: string): Promise<{ latitude: number; longitude: number } | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1`;
      console.log(`[CamoufoxFacebookSession] Geocoding location: "${locationName}"`);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OpenFB/1.0 (marketplace search)' },
      });
      if (!response.ok) {
        console.log(`[CamoufoxFacebookSession] Geocoding failed: HTTP ${response.status}`);
        return null;
      }
      const data = await response.json() as any[];
      if (!data || data.length === 0) {
        console.log(`[CamoufoxFacebookSession] Geocoding returned no results for "${locationName}"`);
        return null;
      }
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      console.log(`[CamoufoxFacebookSession] Geocoded "${locationName}" → ${lat}, ${lon} (${data[0].display_name})`);
      return { latitude: lat, longitude: lon };
    } catch (err) {
      console.log(`[CamoufoxFacebookSession] Geocoding error: ${(err as Error).message}`);
      return null;
    }
  }

  private async applyMarketplaceFilters(filters: MarketplaceSearchFilters): Promise<void> {
    if (!this.page) return;

    // Set location if provided as text — but only if we don't already have
    // coordinates in the URL (which is more reliable).
    if (filters.location && !filters.latitude && !filters.longitude) {
      console.log(`[CamoufoxFacebookSession] Applying location filter via UI: "${filters.location}"`);
      try {
        const locInput = this.page.locator(MKT_SELECTORS.filterLocationInput).first();
        const locVisible = await locInput.isVisible({ timeout: 2000 }).catch(() => false);
        if (!locVisible) {
          console.log('[CamoufoxFacebookSession] Location input not found/visible — skipping UI location filter');
        } else {
          await locInput.click({ timeout: 3000 });
          await locInput.fill(filters.location, { timeout: 3000 });
          await this.page.waitForTimeout(1000);
          // Click the first suggestion
          const suggestion = this.page.locator('ul[role="listbox"] li').first();
          const sugVisible = await suggestion.isVisible({ timeout: 2000 }).catch(() => false);
          if (sugVisible) {
            await suggestion.click({ timeout: 3000 });
            console.log('[CamoufoxFacebookSession] Location suggestion clicked');
          } else {
            console.log('[CamoufoxFacebookSession] No location suggestion appeared — pressing Enter');
            await this.page.keyboard.press('Enter');
          }
          await this.page.waitForTimeout(1000);
        }
      } catch (err) {
        console.log(`[CamoufoxFacebookSession] Location UI filter failed: ${(err as Error).message}`);
      }
    } else if (filters.latitude && filters.longitude) {
      console.log('[CamoufoxFacebookSession] Coordinates already in URL — skipping UI location filter');
    }

    // Set radius if provided
    if (filters.radiusKm) {
      console.log(`[CamoufoxFacebookSession] Applying radius filter: ${filters.radiusKm} km`);
      try {
        const radiusSelect = this.page.locator(MKT_SELECTORS.filterRadiusSelect).first();
        const radVisible = await radiusSelect.isVisible({ timeout: 2000 }).catch(() => false);
        if (!radVisible) {
          console.log('[CamoufoxFacebookSession] Radius select not found — skipping');
        } else {
          await radiusSelect.selectOption({
            label: `${filters.radiusKm} km`,
          }).catch(() => {
            // Try matching by value or partial text
            return this.page!.locator(MKT_SELECTORS.filterRadiusSelect).first()
              .selectOption({ index: 2 }).catch(() => {});
          });
          console.log('[CamoufoxFacebookSession] Radius filter applied');
          await this.page.waitForTimeout(500);
        }
      } catch (err) {
        console.log(`[CamoufoxFacebookSession] Radius filter failed: ${(err as Error).message}`);
      }
    }

    // Set price range
    if (filters.minPrice !== undefined) {
      console.log(`[CamoufoxFacebookSession] Applying min price: ${filters.minPrice}`);
      try {
        const minInput = this.page.locator(MKT_SELECTORS.filterMinPrice).first();
        await minInput.fill(String(filters.minPrice), { timeout: 3000 });
        await this.page.waitForTimeout(500);
      } catch (err) {
        console.log(`[CamoufoxFacebookSession] Min price filter failed: ${(err as Error).message}`);
      }
    }
    if (filters.maxPrice !== undefined) {
      console.log(`[CamoufoxFacebookSession] Applying max price: ${filters.maxPrice}`);
      try {
        const maxInput = this.page.locator(MKT_SELECTORS.filterMaxPrice).first();
        await maxInput.fill(String(filters.maxPrice), { timeout: 3000 });
        await this.page.waitForTimeout(500);
      } catch (err) {
        console.log(`[CamoufoxFacebookSession] Max price filter failed: ${(err as Error).message}`);
      }
    }

    // Set condition filters
    if (filters.condition && filters.condition.length > 0) {
      console.log(`[CamoufoxFacebookSession] Applying condition filter: ${filters.condition.join(', ')}`);
      for (const cond of filters.condition) {
        try {
          const condLabel =
            cond === 'new' ? 'New' :
            cond === 'used_like_new' ? 'Used - Like New' :
            cond === 'used_good' ? 'Used - Good' :
            cond === 'used_fair' ? 'Used - Fair' : '';

          if (condLabel) {
            const checkbox = this.page.locator(`input[type="checkbox"][aria-label*="${condLabel}" i]`).first();
            await checkbox.check({ timeout: 2000 }).catch(() => {});
          }
        } catch {}
      }
    }

    // Click Apply button if it appeared
    try {
      const applyBtn = this.page.locator(MKT_SELECTORS.filterApplyButton).first();
      await applyBtn.click({ timeout: 2000 });
      await this.page.waitForTimeout(2000);
    } catch {}
  }

  private async scrollMarketplaceResults(targetCount: number): Promise<void> {
    if (!this.page) return;
    let lastCount = 0;
    let stableScrolls = 0;
    const maxScrolls = 10;

    for (let i = 0; i < maxScrolls; i++) {
      const currentCount = await this.page.locator(MKT_SELECTORS.listingCard).count();
      if (currentCount >= targetCount) break;
      if (currentCount === lastCount) {
        stableScrolls++;
        if (stableScrolls >= 2) break; // No more results loading
      }
      lastCount = currentCount;

      await this.page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 2);
      });
      await this.page.waitForTimeout(1500);
    }
  }

  private async extractMarketplaceListings(limit: number): Promise<MarketplaceListing[]> {
    if (!this.page) return [];

    const cards = await this.page.locator(MKT_SELECTORS.listingCard).all();
    const listings: MarketplaceListing[] = [];
    const count = Math.min(cards.length, limit);

    for (let i = 0; i < count; i++) {
      try {
        const card = cards[i];
        const href = (await card.getAttribute('href')) || '';
        const listingId = this.extractListingId(href);

        // Each card contains an image and title/price spans
        const imgEl = card.locator(MKT_SELECTORS.listingImage).first();
        const imageUrl = (await imgEl.getAttribute('src')) || undefined;

        // Title and price are spans within the card
        const spans = await card.locator('span[dir="auto"]').allTextContents();
        const title = spans[0]?.trim() || 'Untitled';
        const priceText = spans[1]?.trim() || '';
        const location = spans[2]?.trim() || '';

        const { price, currency } = this.parsePrice(priceText);

        listings.push({
          id: listingId,
          title,
          price,
          currency,
          location,
          imageUrl,
          listingUrl: `https://www.facebook.com${href}`,
          isAvailable: true,
        });
      } catch {
        // Skip cards that fail to parse
      }
    }

    return listings;
  }

  private extractListingId(url: string): string {
    const match = url.match(/\/marketplace\/item\/(\d+)/);
    return match ? match[1] : url;
  }

  private parsePrice(text: string): { price: number; currency: string } {
    // Handles formats like "$1,234", "€1.234,56", "£50", "1.234,56 €", "USD 100"
    const cleaned = text.replace(/[^\d.,]/g, '').trim();
    if (!cleaned) return { price: 0, currency: '' };

    // Detect currency symbol
    let currency = 'USD';
    if (text.includes('$')) currency = 'USD';
    else if (text.includes('€')) currency = 'EUR';
    else if (text.includes('£')) currency = 'GBP';
    else if (text.includes('¥')) currency = 'JPY';

    // Handle both 1,234.56 and 1.234,56 formats
    let numeric: number;
    if (cleaned.includes('.') && cleaned.includes(',')) {
      // Last separator is the decimal
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        // European format: 1.234,56
        numeric = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
      } else {
        // US format: 1,234.56
        numeric = parseFloat(cleaned.replace(/,/g, ''));
      }
    } else if (cleaned.includes(',')) {
      // Could be thousands separator or decimal
      const parts = cleaned.split(',');
      if (parts.length === 2 && parts[1].length <= 2) {
        numeric = parseFloat(cleaned.replace(',', '.'));
      } else {
        numeric = parseFloat(cleaned.replace(/,/g, ''));
      }
    } else {
      numeric = parseFloat(cleaned);
    }

    return { price: isNaN(numeric) ? 0 : numeric, currency };
  }

  private parseCondition(text: string): 'new' | 'used' | 'refurbished' | 'unknown' {
    const t = text.toLowerCase();
    if (t.includes('new') && !t.includes('used')) return 'new';
    if (t.includes('used') || t.includes('like new') || t.includes('good') || t.includes('fair')) return 'used';
    if (t.includes('refurbished')) return 'refurbished';
    return 'unknown';
  }

  async markAsRead(chatId: string): Promise<void> {
    this.requireAuthenticated();
    if (!this.page) throw new Error('Page not ready');

    const chatUrl = `https://www.messenger.com/t/${chatId}`;
    await this.page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(1000);
    // Simply visiting the chat marks it as read in Messenger
  }

  // ──────────────────────────────────────────────
  //  Incoming message listener
  // ──────────────────────────────────────────────

  async startListening(): Promise<void> {
    if (this.listening || !this.page) return;
    this.listening = true;

    // Poll for new messages in the active conversation
    // (A more sophisticated approach would use a MutationObserver injected
    // into the page, but polling is simpler and more robust to FB UI changes.)
    const pollInterval = setInterval(async () => {
      if (!this.listening || !this.page) return;
      try {
        const currentMessages = await this.page
          .locator(FB_SELECTORS.messageText)
          .count();

        if (currentMessages > this.lastMessageCount) {
          // New messages arrived — extract the newest ones
          const newCount = currentMessages - this.lastMessageCount;
          const newMessages = await this.extractLatestMessages(newCount);
          for (const msg of newMessages) {
            this.emit('message', msg);
          }
          this.lastMessageCount = currentMessages;
        }
      } catch {
        // Silently ignore polling errors (page might be navigating)
      }
    }, 3000);

    // Store interval for cleanup
    (this as any)._pollInterval = pollInterval;
  }

  async stopListening(): Promise<void> {
    this.listening = false;
    const interval = (this as any)._pollInterval as NodeJS.Timeout | undefined;
    if (interval) {
      clearInterval(interval);
      (this as any)._pollInterval = undefined;
    }
  }

  private async extractLatestMessages(count: number): Promise<FacebookMessage[]> {
    if (!this.page) return [];
    try {
      const texts = await this.page.locator(FB_SELECTORS.messageText).allTextContents();
      const recent = texts.slice(-count);
      const url = this.page.url();
      const chatId = this.extractChatId(url);

      return recent.map((text, i) => ({
        id: `msg_incoming_${Date.now()}_${i}`,
        chatId,
        senderId: chatId,
        senderName: 'Unknown',
        text,
        timestamp: new Date(),
        direction: 'inbound' as const,
      }));
    } catch {
      return [];
    }
  }

  // ──────────────────────────────────────────────
  //  Status & cleanup
  // ──────────────────────────────────────────────

  async disconnect(): Promise<void> {
    await this.stopListening();
    try {
      await this.page?.close();
    } catch {}
    try {
      await this.context?.close();
    } catch {}
    try {
      await this.browser?.close();
    } catch {}
    this.page = null;
    this.context = null;
    this.browser = null;
    this.setState('disconnected');
  }

  // ──────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────

  private requireAuthenticated(): void {
    if (this.state !== 'authenticated') {
      throw new Error(`Session is not authenticated (current state: ${this.state})`);
    }
  }

  private setState(state: SessionState): void {
    this.state = state;
    this.emit('state_change', state);
  }

  private extractChatId(url: string): string {
    // Messenger URLs: https://www.messenger.com/t/1234567890
    const match = url.match(/\/t\/(\d+)/);
    return match ? match[1] : url;
  }
}
