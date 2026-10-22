import { Product, Store } from '@mandate/db';
import { TRPCError } from '@trpc/server';

import { cartRequestSchema, cartTotalCents, serverPricedCartSchema } from './cart';

/** Internal server helper. Do not accept client prices, categories or payment recipients. */
export async function priceCart(input: unknown) {
  const request = cartRequestSchema.parse(input);
  const store = await Store.findById(request.storeId).select('_id paypalMerchantId').lean();
  if (!store) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
  const products = await Product.find({
    _id: { $in: request.items.map((item) => item.productId) },
    storeId: request.storeId,
    active: true,
  }).select('_id category priceCents currency').lean();
  if (products.length !== request.items.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart contains an unavailable product' });
  }
  if (products.some((product) => product.currency !== 'USD')) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Cart currency must be USD' });
  }
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const cart = serverPricedCartSchema.parse({
    storeId: request.storeId,
    payeeId: store.paypalMerchantId,
    currency: 'USD',
    items: request.items.map((item) => {
      const product = byId.get(item.productId)!;
      return { ...item, category: product.category, unitPriceCents: product.priceCents };
    }),
  });
  cartTotalCents(cart);
  return cart;
}
