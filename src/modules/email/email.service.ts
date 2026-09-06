import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { MarketplaceListing } from '../marketplace/marketplace.types';

/**
 * Email service for sending marketplace search results via Gmail.
 *
 * Uses nodemailer with Gmail SMTP and App Passwords.
 * Create an App Password at: https://myaccount.google.com/apppasswords
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null = null;
  private readonly fromAddress: string;
  private readonly defaultTo: string;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('GMAIL_USER') || '';
    const pass = this.config.get<string>('GMAIL_APP_PASSWORD') || '';
    const to = this.config.get<string>('GMAIL_TO') || '';

    this.fromAddress = user;
    this.defaultTo = to || user;

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      });
      this.logger.log(`Gmail transporter initialized for ${user}`);
    } else {
      this.logger.warn(
        'Gmail not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env to send emails.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Send marketplace search results as a formatted HTML email.
   */
  async sendMarketplaceResults(
    to: string,
    query: string,
    listings: MarketplaceListing[],
    searchUrl: string,
  ): Promise<void> {
    if (!this.transporter) {
      throw new Error(
        'Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in your .env file.',
      );
    }

    const recipient = to || this.defaultTo;
    if (!recipient) {
      throw new Error('No email recipient specified and GMAIL_TO/GMAIL_USER not set.');
    }

    this.logger.log(
      `Preparing email: ${listings.length} listings, query="${query}", ` +
        `from=${this.fromAddress}, to=${recipient}`,
    );

    const subject = `🛍️ ${listings.length} resultados de Marketplace: "${query}"`;

    const html = this.buildHtmlEmail(query, listings, searchUrl);

    try {
      const info = await this.transporter.sendMail({
        from: `OpenFB <${this.fromAddress}>`,
        to: recipient,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${recipient} — messageId=${info.messageId}, response="${info.response}"`);
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${recipient}: ${(err as Error).message}\n` +
          `Check: GMAIL_USER=${this.fromAddress ? 'set' : 'NOT SET'}, ` +
          `GMAIL_APP_PASSWORD=${this.transporter ? 'set' : 'NOT SET'}, ` +
          `recipient="${recipient}"`,
      );
      throw err;
    }
  }

  private buildHtmlEmail(
    query: string,
    listings: MarketplaceListing[],
    searchUrl: string,
  ): string {
    const items = listings
      .map((item, i) => {
        const price = item.price
          ? `${item.currency} ${item.price.toLocaleString()}`
          : 'Sin precio';
        const img = item.imageUrl
          ? `<img src="${item.imageUrl}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;" />`
          : '<div style="width:120px;height:120px;background:#eee;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999;">Sin imagen</div>';
        const condition = item.condition ? ` · ${item.condition}` : '';
        const location = item.location ? ` · 📍 ${item.location}` : '';
        const date = item.postedDate
          ? ` · ${new Date(item.postedDate).toLocaleDateString('es')}`
          : '';

        return `
        <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #eee;">
          <a href="${item.listingUrl}" target="_blank">${img}</a>
          <div style="flex:1;">
            <div style="font-weight:bold;font-size:15px;">
              <a href="${item.listingUrl}" target="_blank" style="color:#1877f2;text-decoration:none;">
                ${i + 1}. ${item.title}
              </a>
            </div>
            <div style="font-size:18px;font-weight:bold;color:#0a7; margin:4px 0;">${price}</div>
            <div style="font-size:12px;color:#666;">${condition}${location}${date}</div>
          </div>
        </div>`;
      })
      .join('');

    return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1877f2;color:white;padding:20px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:22px;">🛍️ Resultados de Marketplace</h1>
        <p style="margin:4px 0 0;opacity:0.9;">Búsqueda: "${query}"</p>
      </div>
      <div style="background:white;padding:16px;border:1px solid #ddd;border-top:none;">
        <p style="color:#666;font-size:14px;margin:0 0 12px;">
          Se encontraron <strong>${listings.length}</strong> resultados.
        </p>
        ${items}
      </div>
      <div style="text-align:center;padding:16px;font-size:12px;color:#999;">
        <a href="${searchUrl}" target="_blank" style="color:#1877f2;">Ver búsqueda completa en Facebook</a>
        <br/>Enviado por OpenFB · Camoufox Engine
      </div>
    </div>`;
  }
}
