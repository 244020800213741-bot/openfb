/**
 * Marketplace types — search listings on Facebook Marketplace.
 */

export interface MarketplaceListing {
  id: string;
  title: string;
  price: number;
  currency: string;
  location: string;
  imageUrl?: string;
  listingUrl: string;
  sellerName?: string;
  sellerId?: string;
  postedDate?: Date;
  /** Distance in km from the search location (if available) */
  distanceKm?: number;
  condition?: 'new' | 'used' | 'refurbished' | 'unknown';
  category?: string;
  isAvailable: boolean;
}

export interface MarketplaceSearchFilters {
  /** Search query text */
  query: string;
  /** Location text (city, address, or place name) */
  location?: string;
  /** Latitude/longitude for radius search */
  latitude?: number;
  longitude?: number;
  /** Search radius in km */
  radiusKm?: number;
  /** Minimum price */
  minPrice?: number;
  /** Maximum price */
  maxPrice?: number;
  /** Sort order */
  sortBy?: MarketplaceSort;
  /** Condition filter */
  condition?: MarketplaceCondition[];
  /** Only listings posted after this date */
  postedAfter?: Date;
  /** Listing type */
  itemType?: 'item' | 'vehicle' | 'housing' | 'all';
  /** Max results to return */
  limit?: number;
}

export type MarketplaceSort =
  | 'relevance'
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'nearest';

export type MarketplaceCondition =
  | 'new'
  | 'used_like_new'
  | 'used_good'
  | 'used_fair';

/** Configuration for a marketplace monitoring session. */
export interface MarketplaceMonitorConfig {
  /** Search query (e.g. "iPhone 13") */
  query: string;
  /** Location text (city, address, place name) */
  location?: string;
  /** Search radius in km */
  radiusKm?: number;
  /** Minimum price */
  minPrice?: number;
  /** Maximum price */
  maxPrice?: number;
  /** Sort order */
  sortBy?: string;
  /** Condition filter(s) */
  condition?: string[];
  /** Only listings posted after this date */
  postedAfter?: string;
  /** Listing type */
  itemType?: string;
  /** How often to run the search, in minutes */
  intervalMinutes: number;
  /** Maximum number of results to send per email */
  maxResults: number;
  /** Email recipient (defaults to GMAIL_TO or GMAIL_USER from env) */
  emailTo?: string;
}

export interface MarketplaceSearchResult {
  listings: MarketplaceListing[];
  totalFound: number;
  filters: MarketplaceSearchFilters;
  searchUrl: string;
  timestamp: Date;
  hasMore: boolean;
}
