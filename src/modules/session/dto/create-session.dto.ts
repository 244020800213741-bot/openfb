import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MarketplaceMonitorDto {
  @ApiProperty({ example: 'iPhone 13', description: 'Search query text' })
  @IsString()
  query!: string;

  @ApiPropertyOptional({ example: 'Madrid, Spain', description: 'Location text' })
  @IsOptional()
  @IsString()
  location?: string;

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

  @ApiPropertyOptional({ example: 'price_asc', description: 'Sort: relevance, price_asc, price_desc, newest, nearest' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ example: ['new', 'used_like_new'], description: 'Condition filter(s)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  condition?: string[];

  @ApiPropertyOptional({ example: '2026-08-01', description: 'Only listings posted after this date' })
  @IsOptional()
  @IsDateString()
  postedAfter?: string;

  @ApiPropertyOptional({ example: 'all', description: 'Listing type: item, vehicle, housing, all' })
  @IsOptional()
  @IsString()
  itemType?: string;

  @ApiProperty({ example: 30, description: 'How often to run the search, in minutes' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  intervalMinutes!: number;

  @ApiProperty({ example: 10, description: 'Max results to send per email' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxResults!: number;

  @ApiPropertyOptional({ example: 'myemail@gmail.com', description: 'Email recipient (defaults to GMAIL_TO or GMAIL_USER)' })
  @IsOptional()
  @IsString()
  emailTo?: string;
}

export class CreateSessionDto {
  @ApiProperty({ example: 'My Facebook Session' })
  @IsString()
  label!: string;

  @ApiPropertyOptional({ enum: ['main', 'marketplace'], default: 'main' })
  @IsOptional()
  @IsEnum(['main', 'marketplace'])
  type?: 'main' | 'marketplace';

  @ApiPropertyOptional({ type: MarketplaceMonitorDto, description: 'Marketplace monitor config (required when type=marketplace)' })
  @IsOptional()
  monitor?: MarketplaceMonitorDto;
}
