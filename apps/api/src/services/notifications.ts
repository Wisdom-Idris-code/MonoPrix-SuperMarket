import { config } from '../lib/config.js';

export type NotificationMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailProvider {
  send(message: NotificationMessage): Promise<void>;
}

export interface SmsProvider {
  send(phone: string, message: string): Promise<void>;
}

class ResendEmailProvider implements EmailProvider {
  async send(message: NotificationMessage) {
    if (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL) {
      console.info(`[email:demo] ${message.subject} queued for configured customer; Resend is not configured.`);
      return;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.RESEND_FROM_EMAIL,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend request failed (${response.status}): ${body.slice(0, 300)}`);
    }
  }
}

class UnconfiguredSmsProvider implements SmsProvider {
  async send(_phone: string, _message: string) {
    console.info('[sms:demo] SMS provider is not configured.');
  }
}

export const emailProvider: EmailProvider = new ResendEmailProvider();
export const smsProvider: SmsProvider = new UnconfiguredSmsProvider();
