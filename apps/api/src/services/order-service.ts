import { Prisma } from '@prisma/client';
import { config } from '../lib/config.js';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { emailProvider } from './notifications.js';

const DELIVERY_FEE = new Prisma.Decimal(20000);
export type CreateOrderInput = {
  customerName: string;
  phone: string;
  email?: string;
  addressLine: string;
  area: string;
  instructions?: string;
  paymentMethod: 'CASH_ON_DELIVERY' | 'MONIME' | 'MOCK_MOBILE_MONEY' | 'MOCK_CARD';
  idempotencyKey: string;
};

export async function createOrder(userId: string, input: CreateOrderInput) {
  if (input.paymentMethod.startsWith('MOCK_') && (!config.ENABLE_MOCK_PAYMENTS || config.NODE_ENV === 'production')) {
    throw new HttpError(503, 'Mock payments are disabled outside isolated development and test environments.', 'MOCK_PAYMENTS_DISABLED');
  }
  const existing = await prisma.order.findFirst({
    where: { userId, idempotencyKey: input.idempotencyKey },
    include: { items: true, payment: true, delivery: true },
  });
  if (existing) return existing;

  const order = await prisma.$transaction(async (transaction) => {
    const cart = await transaction.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true, variant: true } } },
    });
    if (!cart?.items.length) throw new HttpError(400, 'Your cart is empty.', 'EMPTY_CART');

    const orderItems: Array<{
      productId: string;
      variantId: string;
      productName: string;
      variantName: string;
      variantQuantity: Prisma.Decimal;
      variantUnit: string;
      variantSku: string;
      unitPrice: Prisma.Decimal;
      quantity: number;
      totalPrice: Prisma.Decimal;
    }> = [];
    let subtotal = new Prisma.Decimal(0);

    for (const item of cart.items) {
      if (!item.product.isActive) {
        throw new HttpError(409, `${item.product.name} is no longer available.`, 'PRODUCT_UNAVAILABLE');
      }
      if (!item.variant.isActive) {
        throw new HttpError(409, `${item.product.name} (${item.variant.name}) is no longer available.`, 'VARIANT_UNAVAILABLE');
      }
      if (item.quantity > item.variant.stock) {
        throw new HttpError(409, `Only ${item.variant.stock} ${item.product.name} (${item.variant.name}) available.`, 'INSUFFICIENT_STOCK');
      }
      const unitPrice = new Prisma.Decimal(item.variant.price);
      const itemTotal = unitPrice.mul(item.quantity);
      subtotal = subtotal.add(itemTotal);
      orderItems.push({
        productId: item.productId,
        variantId: item.variantId,
        productName: item.product.name,
        variantName: item.variant.name,
        variantQuantity: new Prisma.Decimal(item.variant.quantity),
        variantUnit: item.variant.unit,
        variantSku: item.variant.sku,
        unitPrice,
        quantity: item.quantity,
        totalPrice: itemTotal,
      });
    }

    for (const item of cart.items) {
      const stockUpdate = await transaction.productVariant.updateMany({
        where: { id: item.variantId, productId: item.productId, isActive: true, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (stockUpdate.count !== 1) {
        throw new HttpError(409, `Stock changed while placing your order. Please review your cart.`, 'INSUFFICIENT_STOCK');
      }
      if (item.variant.isDefault) {
        await transaction.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity }, price: item.variant.price },
        });
      }
      await transaction.inventoryMovement.create({
        data: {
          productId: item.productId,
          variantId: item.variantId,
          type: 'ORDER',
          quantity: -item.quantity,
          reason: 'Stock reserved for customer order',
          reference: input.idempotencyKey,
        },
      });
    }

    const provider = input.paymentMethod === 'CASH_ON_DELIVERY'
      ? 'cash-on-delivery'
      : input.paymentMethod === 'MONIME' ? 'monime' : 'mock';
    const created = await transaction.order.create({
      data: {
        userId,
        idempotencyKey: input.idempotencyKey,
        customerName: input.customerName,
        phone: input.phone,
        email: input.email,
        addressLine: input.addressLine,
        area: input.area,
        instructions: input.instructions,
        paymentMethod: input.paymentMethod,
        paymentStatus: 'PENDING',
        subtotal,
        deliveryFee: DELIVERY_FEE,
        total: subtotal.add(DELIVERY_FEE),
        items: { create: orderItems },
        delivery: { create: { status: 'PENDING' } },
        payment: {
          create: {
            provider,
            transactionRef: `${provider.toUpperCase()}-${input.idempotencyKey}`,
            amount: subtotal.add(DELIVERY_FEE),
            status: 'PENDING',
          },
        },
      },
      include: { items: true, payment: true, delivery: true },
    });

    if (created.payment) {
      await transaction.paymentEvent.create({
        data: {
          paymentId: created.payment.id,
          provider,
          eventId: `${provider}-created-${created.payment.id}`,
          eventType: 'PAYMENT_CREATED',
          payload: JSON.stringify({ orderId: created.id, amount: created.payment.amount.toString(), currency: created.payment.currency }),
        },
      });
    }

    await transaction.cartItem.deleteMany({ where: { cartId: cart.id } });
    await transaction.auditLog.create({
      data: {
        userId,
        action: 'ORDER_CREATED',
        entity: 'Order',
        details: `Order ${created.id} created for ${created.total.toString()} SLE`,
      },
    });
    await transaction.notification.create({
      data: {
        userId,
        orderId: created.id,
        type: 'ORDER_CREATED',
        message: `Order ${created.id} has been received.`,
      },
    });

    return created;
  });

  if (input.email) {
    try {
      await emailProvider.send({
        to: input.email,
        subject: `Order ${order.id} received`,
        text: `Your demonstration order ${order.id} is received. Total: SLE ${order.total.toString()}.`,
      });
    } catch (error) {
      console.error(`Order confirmation email failed for order ${order.id}:`, error);
    }
  }
  return order;
}

export async function updateOrderStatus(orderId: string, status: string, actorId: string) {
  const allowedStatuses = ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
  if (!allowedStatuses.includes(status)) throw new HttpError(400, 'Invalid order status.', 'INVALID_ORDER_STATUS');

  const order = await prisma.$transaction(async (transaction) => {
    const current = await transaction.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!current) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    if (current.status === status) return transaction.order.findUniqueOrThrow({ where: { id: orderId } });
    if (current.status === 'CANCELLED' || current.status === 'DELIVERED') {
      throw new HttpError(409, 'Delivered or cancelled orders cannot be changed.', 'TERMINAL_ORDER_STATUS');
    }
    if (status === 'CONFIRMED' && current.paymentMethod !== 'CASH_ON_DELIVERY' && current.paymentStatus !== 'PAID') {
      throw new HttpError(409, 'Online payment must be verified before an order can be confirmed.', 'PAYMENT_REQUIRED');
    }
    const transitions: Record<string, string[]> = {
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PROCESSING', 'CANCELLED'],
      PROCESSING: ['READY_FOR_DELIVERY', 'CANCELLED'],
      READY_FOR_DELIVERY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
      OUT_FOR_DELIVERY: ['DELIVERED'],
    };
    if (!transitions[current.status]?.includes(status)) {
      throw new HttpError(409, `Order cannot transition from ${current.status} to ${status}.`, 'INVALID_STATUS_TRANSITION');
    }
    if (status === 'CANCELLED' && current.paymentStatus === 'PAID') {
      throw new HttpError(409, 'An order with a completed payment cannot be cancelled automatically.', 'REFUND_REQUIRED');
    }
    if (status === 'CANCELLED' && current.paymentMethod === 'MONIME' && current.paymentStatus === 'PENDING') {
      throw new HttpError(409, 'Wait for the hosted checkout to be cancelled or expire before cancelling this order.', 'PAYMENT_SESSION_PENDING');
    }

    if (status === 'CANCELLED') {
      for (const item of current.items) {
        if (item.variantId) {
          const variant = await transaction.productVariant.findUnique({ where: { id: item.variantId } });
          await transaction.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
          if (variant?.isDefault) {
            await transaction.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.quantity } },
            });
          }
        } else {
          await transaction.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await transaction.inventoryMovement.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            type: 'ORDER_CANCELLATION',
            quantity: item.quantity,
            reason: `Restock for cancelled order ${orderId}`,
            reference: orderId,
          },
        });
      }

    }

    if (status === 'DELIVERED' && current.paymentMethod === 'CASH_ON_DELIVERY') {
      const payment = await transaction.payment.findUnique({ where: { orderId } });
      if (payment) {
        await transaction.paymentEvent.create({
          data: {
            paymentId: payment.id,
            provider: 'cash-on-delivery',
            eventId: `cod-delivered-${orderId}`,
            eventType: 'CASH_ON_DELIVERY_COLLECTED',
            payload: JSON.stringify({ orderId }),
          },
        });
      }
    }

    const updated = await transaction.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(status === 'DELIVERED' && current.paymentMethod === 'CASH_ON_DELIVERY' ? { paymentStatus: 'PAID' } : {}),
        ...(status === 'DELIVERED' && current.paymentMethod === 'CASH_ON_DELIVERY'
          ? { payment: { update: { status: 'PAID' } } }
          : {}),
        ...(status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED'
          ? { delivery: { update: { status: status === 'OUT_FOR_DELIVERY' ? 'IN_TRANSIT' : 'DELIVERED' } } }
          : {}),
      },
    });
    await transaction.notification.create({
      data: {
        userId: updated.userId,
        orderId: updated.id,
        type: 'ORDER_STATUS',
        message: `Order ${updated.id} status changed to ${status}.`,
      },
    });
    await transaction.auditLog.create({
      data: { userId: actorId, action: 'ORDER_STATUS_UPDATED', entity: 'Order', details: `${orderId}: ${current.status} -> ${status}` },
    });
    return updated;
  });

  if (order.email) {
    try {
      await emailProvider.send({
        to: order.email,
        subject: `Order ${order.id} update`,
        text: `Your demonstration order status is now ${status}.`,
      });
    } catch (error) {
      console.error(`Order status email failed for order ${order.id}:`, error);
    }
  }
  return order;
}
