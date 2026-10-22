import { policyCategories } from '@mandate/db';
import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i).transform((id) => id.toLowerCase());
export const cents = z.number().int().nonnegative().safe();
const quantity = z.number().int().positive().safe();
const category = z.enum(policyCategories);
const uniqueProducts = (items: { productId: string }[]) =>
  new Set(items.map((item) => item.productId)).size === items.length;

export const cartRequestSchema = z.strictObject({
  storeId: objectId,
  items: z.array(z.strictObject({ productId: objectId, quantity }))
    .min(1).max(100).refine(uniqueProducts, 'Duplicate product IDs'),
});

// Only a server catalog lookup may supply payee, category, currency and price.
export const serverPricedCartSchema = z.strictObject({
  storeId: objectId,
  payeeId: z.string().trim().min(1),
  currency: z.literal('USD'),
  items: z.array(z.strictObject({ productId: objectId, category, unitPriceCents: cents, quantity }))
    .min(1).max(100).refine(uniqueProducts, 'Duplicate product IDs'),
});

export type ServerPricedCart = z.infer<typeof serverPricedCartSchema>;

export function cartTotalCents(cart: ServerPricedCart): number {
  let total = 0;
  for (const item of cart.items) {
    const lineTotal = item.unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal)) {
      throw new Error('Cart amount exceeds safe integer cents');
    }
    total += lineTotal;
  }
  return total;
}
