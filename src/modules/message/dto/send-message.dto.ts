import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum, IsObject } from 'class-validator';

export class SendTextDto {
  @ApiProperty({ example: '1000123456', description: 'Facebook chat ID (numeric thread ID)' })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({ example: 'Hello from OpenFB!', description: 'Message text to send' })
  @IsString()
  @IsNotEmpty()
  text: string;
}

export class SendMediaDto {
  @ApiProperty({ description: 'Chat ID' })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({ enum: ['image', 'file', 'audio'], description: 'Media type' })
  @IsEnum(['image', 'file', 'audio'])
  type: string;

  @ApiProperty({ description: 'Base64-encoded media data or file path/URL' })
  @IsString()
  @IsNotEmpty()
  data: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mimeType?: string;
}
