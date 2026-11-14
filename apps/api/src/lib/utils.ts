import { Decimal } from '@prisma/client/runtime/library';

export function toNumber(value: string | number | Decimal) {
  return Number(value.toString());
}

export function toMoney(value: number | string) {
  return Number(value).toFixed(2);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function asSLE(value: number) {
  return `NLe ${value.toLocaleString('en-SL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
