/**
 * Media download and conversion utilities.
 * Mirrors OpenWA's media module — converts browser-captured media
 * (base64, blob URLs) into usable formats for API consumers.
 */
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  /**
   * Convert a base64 data URL into a buffer.
   */
  base64ToBuffer(base64: string): Buffer {
    const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
    return Buffer.from(cleaned, 'base64');
  }

  /**
   * Convert a buffer to a base64 data URL with a given MIME type.
   */
  bufferToDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  /**
   * Determine if a string is a base64-encoded data URL.
   */
  isBase64DataUrl(str: string): boolean {
    return str.startsWith('data:') && str.includes(';base64,');
  }

  /**
   * Determine if a string is a URL.
   */
  isUrl(str: string): boolean {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Determine if a string is a file path.
   */
  isFilePath(str: string): boolean {
    return str.startsWith('/') || str.startsWith('./') || str.startsWith('../');
  }

  /**
   * Extract the file extension from a filename or path.
   */
  getExtension(filename: string): string {
    const match = filename.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
  }

  /**
   * Guess MIME type from file extension.
   */
  guessMimeType(filename: string): string {
    const ext = this.getExtension(filename);
    const types: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      mp4: 'video/mp4',
      webm: 'video/webm',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
    };
    return types[ext] ?? 'application/octet-stream';
  }
}
