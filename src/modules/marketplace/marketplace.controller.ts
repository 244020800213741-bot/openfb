import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SessionManagerService } from '../session/session-manager.service';
import { MarketplaceSearchDto } from './dto/marketplace-search.dto';
import type { MarketplaceSearchFilters, MarketplaceSort, MarketplaceCondition } from './marketplace.types';

/**
 * Marketplace search controller.
 *
 * Exposes Marketplace search with full filtering capabilities:
 *   - Price range (min/max)
 *   - Distance/radius
 *   - Posted-after date
 *   - Condition (new, used-like-new, used-good, used-fair)
 *   - Sort (relevance, price_asc, price_desc, newest, nearest)
 *   - Item type (item, vehicle, housing)
 *   - Location (text or lat/lng)
 */
@ApiTags('Marketplace')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('session/:sessionId/marketplace')
export class MarketplaceController {
  constructor(private readonly sessionManager: SessionManagerService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search Facebook Marketplace with filters (price, distance, date, condition)',
    description:
      'Searches Marketplace listings. Supports filtering by price range, location/radius, ' +
      'posting date, condition, and sort order. Results include title, price, image, and location.',
  })
  async search(
    @Param('sessionId') sessionId: string,
    @Query() dto: MarketplaceSearchDto,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const filters: MarketplaceSearchFilters = {
      query: dto.query,
      location: dto.location,
      latitude: dto.latitude,
      longitude: dto.longitude,
      radiusKm: dto.radiusKm,
      minPrice: dto.minPrice,
      maxPrice: dto.maxPrice,
      sortBy: dto.sortBy as MarketplaceSort | undefined,
      condition: dto.condition as MarketplaceCondition[] | undefined,
      postedAfter: dto.postedAfter ? new Date(dto.postedAfter) : undefined,
      itemType: dto.itemType,
      limit: dto.limit ?? 24,
    };

    return session.searchMarketplace(filters);
  }

  @Post('search')
  @ApiOperation({ summary: 'Search Marketplace via POST body (same filters as GET)' })
  async searchPost(
    @Param('sessionId') sessionId: string,
    @Body() dto: MarketplaceSearchDto,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const filters: MarketplaceSearchFilters = {
      query: dto.query,
      location: dto.location,
      latitude: dto.latitude,
      longitude: dto.longitude,
      radiusKm: dto.radiusKm,
      minPrice: dto.minPrice,
      maxPrice: dto.maxPrice,
      sortBy: dto.sortBy as MarketplaceSort | undefined,
      condition: dto.condition as MarketplaceCondition[] | undefined,
      postedAfter: dto.postedAfter ? new Date(dto.postedAfter) : undefined,
      itemType: dto.itemType,
      limit: dto.limit ?? 24,
    };

    return session.searchMarketplace(filters);
  }

  @Get('item/:listingId')
  @ApiOperation({ summary: 'Get details of a specific Marketplace listing' })
  async getListing(
    @Param('sessionId') sessionId: string,
    @Param('listingId') listingId: string,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.getMarketplaceListing(listingId);
  }
}
