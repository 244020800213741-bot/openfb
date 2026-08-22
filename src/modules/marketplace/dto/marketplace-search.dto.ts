import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  IsDateString,
  Min,
} from 'class-validator';

export enum MarketplaceSortEnum {
  RELEVANCE = 'relevance',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NEWEST = 'newest',
  NEAREST = 'nearest',
}

export enum MarketplaceConditionEnum {
  NEW = 'new',
  USED_LIKE_NEW = 'used_like_new',
  USED_GOOD = 'used_good',
  USED_FAIR = 'used_fair',
}

export enum MarketplaceItemTypeEnum {
  ITEM = 'item',
  VEHICLE = 'vehicle',
  HOUSING = 'housing',
  ALL = 'all',
}

export class MarketplaceSearchDto {
  @ApiProperty({ example: 'iPhone 13', description: 'Search query text' })
  @IsString()
  query!: string;

  @ApiPropertyOptional({ example: 'Madrid, Spain', description: 'Location text (city, address, place name)' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 40.4168, description: 'Latitude for radius search' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  latitude?: number;

  @ApiPropertyOptional({ example: -3.7038, description: 'Longitude for radius search' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ example: 10, description: 'Search radius in kilometers' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  radiusKm?: number;

  @ApiPropertyOptional({ example: 50, description: 'Minimum price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 500, description: 'Maximum price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    enum: MarketplaceSortEnum,
    example: 'price_asc',
    description: 'Sort order: relevance, price_asc, price_desc, newest, nearest',
  })
  @IsOptional()
  @IsEnum(MarketplaceSortEnum)
  sortBy?: MarketplaceSortEnum;

  @ApiPropertyOptional({
    enum: MarketplaceConditionEnum,
    isArray: true,
    description: 'Condition filter(s)',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(MarketplaceConditionEnum, { each: true })
  condition?: MarketplaceConditionEnum[];

  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Only show listings posted after this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  postedAfter?: string;

  @ApiPropertyOptional({
    enum: MarketplaceItemTypeEnum,
    default: 'all',
    description: 'Listing type',
  })
  @IsOptional()
  @IsEnum(MarketplaceItemTypeEnum)
  itemType?: MarketplaceItemTypeEnum;

  @ApiPropertyOptional({ example: 24, default: 24, description: 'Max results to return' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}
