import type {
  MarketplaceSearchFilters,
  MarketplaceSearchResult,
  MarketplaceListing,
} from '../../modules/marketplace/marketplace.types';

/**
 * Core engine interfaces — define the contract that any Facebook automation
 * adapter must implement. This mirrors OpenWA's pluggable engine pattern.
 */

/**
 * A connected Facebook session driven by a browser automation engine.
 */
export interface FacebookSession {
  /** Unique session identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Current connection state */
  state: SessionState;
  /** When the session was created */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** The Camoufox WebSocket endpoint used */
  wsEndpoint: string;

  /** Send a text message to a Facebook user or page chat */
  sendText(chatId: string, text: string): Promise<SendMessageResult>;
  /** Send media (image, file, audio) to a chat */
  sendMedia(chatId: string, media: MediaInput): Promise<SendMessageResult>;
  /** Get the list of recent conversations */
  getConversations(limit?: number): Promise<ConversationSummary[]>;
  /** Get messages from a specific conversation */
  getMessages(chatId: string, limit?: number): Promise<FacebookMessage[]>;
  /** Get information about a contact or page */
  getContact(contactId: string): Promise<FacebookContact | null>;
  /** Search for conversations, contacts, or messages */
  search(query: string, type?: SearchType): Promise<SearchResult[]>;
  /** Search Facebook Marketplace with filters (price, distance, date) */
  searchMarketplace(filters: MarketplaceSearchFilters): Promise<MarketplaceSearchResult>;
  /** Get details of a specific Marketplace listing */
  getMarketplaceListing(listingId: string): Promise<MarketplaceListing | null>;
  /** Mark a chat as read */
  markAsRead(chatId: string): Promise<void>;
  /** Re-check whether the session is now authenticated (after manual login) */
  checkAuth(): Promise<SessionState>;
  /** Start listening for incoming messages and events */
  startListening(): Promise<void>;
  /** Stop listening */
  stopListening(): Promise<void>;
  /** Disconnect and clean up browser resources */
  disconnect(): Promise<void>;
}

export type SessionState =
  | 'initializing'
  | 'waiting_for_login'
  | 'authenticated'
  | 'disconnected'
  | 'error';

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  chatId: string;
  timestamp: Date;
  error?: string;
}

export interface MediaInput {
  type: 'image' | 'file' | 'audio';
  /** Base64-encoded data or a URL/path */
  data: string;
  filename?: string;
  caption?: string;
  mimeType?: string;
}

export interface ConversationSummary {
  id: string;
  name: string;
  avatarUrl?: string;
  lastMessagePreview?: string;
  lastMessageTimestamp?: Date;
  unreadCount: number;
  isGroup: boolean;
  participantsCount: number;
}

export interface FacebookMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: Date;
  direction: 'inbound' | 'outbound';
  media?: MediaAttachment[];
  reactions?: string[];
  replyTo?: string;
}

export interface MediaAttachment {
  type: 'image' | 'file' | 'audio' | 'video' | 'sticker';
  url?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  base64?: string;
}

export interface FacebookContact {
  id: string;
  name: string;
  avatarUrl?: string;
  isOnline?: boolean;
  type: 'user' | 'page';
}

export type SearchType = 'conversations' | 'contacts' | 'messages';

export interface SearchResult {
  type: SearchType;
  id: string;
  name: string;
  preview?: string;
}

/**
 * Factory contract for creating engine adapters.
 */
export interface EngineAdapter {
  name: string;
  /** Create a new browser-backed Facebook session */
  createSession(sessionId: string, label: string): Promise<FacebookSession>;
  /** Health-check the engine */
  healthCheck(): Promise<{ healthy: boolean; details: string }>;
}
