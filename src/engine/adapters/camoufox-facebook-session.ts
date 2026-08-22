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
  LoginStatus,
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
  // Login
  loginEmail: 'input#email',
  loginPassword: 'input[aria-label="Password"]',
  loginButton: 'button[name="login"]',
  loginForm: 'form[action*="login"]',

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
const FACEBOOK_URL = 'https://www.facebook.com/';

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

  async connect(): Promise<void> {
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

      // Use existing page or create one
      const pages = this.context.pages();
      this.page = pages[0] ?? (await this.context.newPage());

      // Set a realistic viewport
      await this.page.setViewportSize({ width: 1280, height: 800 });

      // Navigate to Messenger
      await this.page.goto(MESSENGER_URL, { waitUntil: 'domcontentloaded' });

      // Wait a moment for potential redirects
      await this.page.waitForTimeout(2000);

      // Check if we're logged in
      const isLoggedIn = await this.checkLoggedIn();
      if (!isLoggedIn) {
        this.setState('waiting_for_login');
      } else {
        this.setState('authenticated');
      }

      this.lastActivityAt = new Date();
    } catch (err) {
      this.setState('error');
      throw new Error(`Failed to connect Camoufox session: ${(err as Error).message}`);
    }
  }

  private async checkLoggedIn(): Promise<boolean> {
    if (!this.page) return false;
    const url = this.page.url();
    // If we're on messenger.com and not redirected to login
    if (url.includes('login') || url.includes('checkpoint')) return false;
    // Check for chat list presence
    try {
      await this.page.waitForSelector(FB_SELECTORS.chatListItem, { timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Log in to Facebook using credentials.
   * After login, cookies persist in the Camoufox user-data-dir profile.
   */
  async loginWithCredentials(email: string, password: string): Promise<boolean> {
    if (!this.page) throw new Error('Browser page not initialized');

    // Navigate to Facebook login
    await this.page.goto(FACEBOOK_URL, { waitUntil: 'domcontentloaded' });
    this.setState('waiting_for_login');

    // Fill login form
    await this.page.fill(FB_SELECTORS.loginEmail, email);
    await this.page.fill(FB_SELECTORS.loginPassword, password);
    await this.page.click(FB_SELECTORS.loginButton);

    // Wait for navigation or error
    await this.page.waitForTimeout(3000);

    const isLoggedIn = await this.checkLoggedIn();
    if (isLoggedIn) {
      // Navigate to Messenger
      await this.page.goto(MESSENGER_URL, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);
      this.setState('authenticated');
      return true;
    }

    // Check for 2FA / checkpoint
    const url = this.page.url();
    if (url.includes('checkpoint') || url.includes('two_step')) {
      this.setState('waiting_for_login');
      throw new Error('Facebook requires 2FA verification. Please complete it manually in the browser.');
    }

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
    const searchUrl = this.buildMarketplaceSearchUrl(filters);

    try {
      // Navigate to Marketplace search
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);

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

    if (filters.latitude && filters.longitude) {
      params.set('latitude', String(filters.latitude));
      params.set('longitude', String(filters.longitude));
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

  private async applyMarketplaceFilters(filters: MarketplaceSearchFilters): Promise<void> {
    if (!this.page) return;

    // Set location if provided as text
    if (filters.location) {
      try {
        const locInput = this.page.locator(MKT_SELECTORS.filterLocationInput).first();
        await locInput.click({ timeout: 3000 });
        await locInput.fill(filters.location, { timeout: 3000 });
        await this.page.waitForTimeout(1000);
        // Click the first suggestion
        const suggestion = this.page.locator('ul[role="listbox"] li').first();
        await suggestion.click({ timeout: 3000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
      } catch {
        // Location filter may not be visible — ignore
      }
    }

    // Set radius if provided
    if (filters.radiusKm) {
      try {
        const radiusSelect = this.page.locator(MKT_SELECTORS.filterRadiusSelect).first();
        await radiusSelect.selectOption({
          label: `${filters.radiusKm} km`,
        }).catch(() => {
          // Try matching by value or partial text
          return this.page!.locator(MKT_SELECTORS.filterRadiusSelect).first()
            .selectOption({ index: 2 }).catch(() => {});
        });
        await this.page.waitForTimeout(500);
      } catch {
        // Radius filter may not be available
      }
    }

    // Set price range
    if (filters.minPrice !== undefined) {
      try {
        const minInput = this.page.locator(MKT_SELECTORS.filterMinPrice).first();
        await minInput.fill(String(filters.minPrice), { timeout: 3000 });
        await this.page.waitForTimeout(500);
      } catch {}
    }
    if (filters.maxPrice !== undefined) {
      try {
        const maxInput = this.page.locator(MKT_SELECTORS.filterMaxPrice).first();
        await maxInput.fill(String(filters.maxPrice), { timeout: 3000 });
        await this.page.waitForTimeout(500);
      } catch {}
    }

    // Set condition filters
    if (filters.condition && filters.condition.length > 0) {
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

  getLoginStatus(): Promise<LoginStatus> {
    return Promise.resolve({
      state: this.state,
      qrCodeUrl: this.state === 'waiting_for_login' ? undefined : undefined,
      error: this.state === 'error' ? 'Session encountered an error' : undefined,
    });
  }

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
