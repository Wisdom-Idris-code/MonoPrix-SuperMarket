import crypto from 'node:crypto';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface PaymentProvider {
  initiatePayment(amount: number, orderId: string, currency: string): Promise<{ reference: string; status: PaymentStatus; provider: string }>;
  verifyPayment(reference: string): Promise<{ status: PaymentStatus; amount: number }>;
}

export class MockPaymentProvider implements PaymentProvider {
  provider = 'mock';

  async initiatePayment(amount: number, orderId: string, currency: string): Promise<{ reference: string; status: PaymentStatus; provider: string }> {
    const reference = `MOCK-${orderId}-${crypto.randomBytes(5).toString('hex')}`;
    return {
      reference,
      status: 'PAID',
      provider: this.provider,
    };
  }

  async verifyPayment(reference: string): Promise<{ status: PaymentStatus; amount: number }> {
    return {
      status: 'PAID',
      amount: 0,
    };
  }
}

export const paymentProvider = new MockPaymentProvider();
