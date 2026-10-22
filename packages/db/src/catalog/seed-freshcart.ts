import { z } from 'zod';

import { User } from '../models/auth.model';
import { Product, Store } from '../models/mandate.model';
import { freshCartProducts, freshCartStore } from './freshcart';

export async function seedFreshCart(merchantUserId: string) {
  z.string().regex(/^[a-f\d]{24}$/i).parse(merchantUserId);
  if (!await User.exists({ _id: merchantUserId })) {
    throw new Error('Merchant user not found; register a local account first');
  }
  await Promise.all([Store.init(), Product.init()]);
  const now = new Date();
  const store = await Store.findOneAndUpdate(
    { _id: freshCartStore._id },
    { $setOnInsert: { ...freshCartStore, merchantUserId, createdAt: now, updatedAt: now } },
    { upsert: true, returnDocument: 'after', runValidators: true, timestamps: false },
  );
  if (String(store.merchantUserId) !== merchantUserId.toLowerCase()) {
    throw new Error('FreshCart already belongs to another merchant; its owner was not changed');
  }
  const products = freshCartProducts.map((product) => new Product({
    ...product, storeId: store._id, currency: 'USD', active: true, createdAt: now, updatedAt: now,
  }));
  await Promise.all(products.map((product) => product.validate()));
  // Insert-only upserts keep operator price/availability changes and existing IDs intact.
  const result = await Product.bulkWrite(products.map((product) => ({
    updateOne: {
      filter: { _id: product._id },
      update: { $setOnInsert: product.toObject() },
      upsert: true,
      timestamps: false,
    },
  })));
  return { storeId: String(store._id), productCount: products.length, insertedProducts: result.upsertedCount };
}
