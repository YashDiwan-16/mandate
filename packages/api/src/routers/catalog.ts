import { Product, Store, policyCategories, type ProductRecord } from '@mandate/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure, router } from '../index';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const pageInput = z.strictObject({
  cursor: objectId.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
const storeOutput = z.strictObject({ id: objectId, name: z.string(), slug: z.string() });
const productOutput = z.strictObject({
  id: objectId,
  storeId: objectId,
  name: z.string(),
  description: z.string(),
  category: z.enum(policyCategories),
  priceCents: z.number().int().nonnegative(),
  currency: z.literal('USD'),
  updatedAt: z.string().datetime(),
});

function productResponse(product: ProductRecord & { _id: unknown }) {
  return {
    id: String(product._id),
    storeId: String(product.storeId),
    name: product.name,
    // Untrusted catalog text: never interpreted as HTML, policy, or tool instructions.
    description: product.description,
    category: product.category,
    priceCents: product.priceCents,
    currency: product.currency ?? 'USD',
    updatedAt: product.updatedAt.toISOString(),
  };
}

export const catalogRouter = router({
  getStore: protectedProcedure.input(z.strictObject({ storeId: objectId }))
    .output(storeOutput)
    .query(async ({ input }) => {
      const store = await Store.findById(input.storeId).select('_id name slug').lean();
      if (!store) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      return { id: String(store._id), name: store.name, slug: store.slug };
    }),

  getProduct: protectedProcedure.input(z.strictObject({ storeId: objectId, productId: objectId }))
    .output(productOutput)
    .query(async ({ input }) => {
      if (!await Store.exists({ _id: input.storeId })) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      }
      const product = await Product.findOne({
        _id: input.productId, storeId: input.storeId, active: true,
      }).lean();
      if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      return productResponse(product);
    }),

  listStores: protectedProcedure.input(pageInput)
    .output(z.strictObject({ items: z.array(storeOutput), nextCursor: objectId.nullable() }))
    .query(async ({ input }) => {
      const stores = await Store.find(input.cursor ? { _id: { $gt: input.cursor } } : {})
        .select('_id name slug').sort({ _id: 1 }).limit(input.limit + 1).lean();
      const items = stores.slice(0, input.limit).map((store) => ({
        id: String(store._id), name: store.name, slug: store.slug,
      }));
      return { items, nextCursor: stores.length > input.limit ? items.at(-1)!.id : null };
    }),

  listProducts: protectedProcedure.input(pageInput.extend({ storeId: objectId }))
    .output(z.strictObject({ items: z.array(productOutput), nextCursor: objectId.nullable() }))
    .query(async ({ input }) => {
      if (!await Store.exists({ _id: input.storeId })) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      }
      const products = await Product.find({
        storeId: input.storeId,
        active: true,
        ...(input.cursor ? { _id: { $gt: input.cursor } } : {}),
      }).sort({ _id: 1 }).limit(input.limit + 1).lean();
      const items = products.slice(0, input.limit).map(productResponse);
      return { items, nextCursor: products.length > input.limit ? items.at(-1)!.id : null };
    }),
});
