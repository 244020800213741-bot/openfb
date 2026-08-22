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

export interface MarketplaceSearchResult {
  listings: MarketplaceListing[];
  totalFound: number;
  filters: MarketplaceSearchFilters;
  searchUrl: string;
  timestamp: Date;
  hasMore: boolean;
}
