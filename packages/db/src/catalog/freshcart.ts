export const freshCartStore = {
  _id: '66fc00000000000000000001',
  name: 'FreshCart',
  slug: 'freshcart',
  // Deliberately not a real PayPal payee. Seeding cannot enable payments.
  paypalMerchantId: 'demo-freshcart-not-a-payee',
} as const;

export const freshCartProducts = [
  { _id: '66fc00000000000000000101', name: 'Bananas', category: 'groceries', priceCents: 199, description: 'A bunch of six ripe bananas.' },
  { _id: '66fc00000000000000000102', name: 'Gala Apples', category: 'groceries', priceCents: 449, description: 'A two-pound bag of crisp Gala apples.' },
  { _id: '66fc00000000000000000103', name: 'Baby Spinach', category: 'groceries', priceCents: 329, description: 'Five ounces of washed baby spinach.' },
  { _id: '66fc00000000000000000104', name: 'Carrots', category: 'groceries', priceCents: 179, description: 'A one-pound bag of whole carrots.' },
  { _id: '66fc00000000000000000105', name: 'Broccoli', category: 'groceries', priceCents: 249, description: 'One fresh broccoli crown.' },
  { _id: '66fc00000000000000000106', name: 'Whole Milk', category: 'groceries', priceCents: 399, description: 'One half-gallon of pasteurized whole milk.' },
  { _id: '66fc00000000000000000107', name: 'Large Eggs', category: 'groceries', priceCents: 479, description: 'One carton of twelve large eggs.' },
  { _id: '66fc00000000000000000108', name: 'Greek Yogurt', category: 'groceries', priceCents: 549, description: 'A 32-ounce tub of plain Greek yogurt.' },
  { _id: '66fc00000000000000000109', name: 'Cheddar Cheese', category: 'groceries', priceCents: 359, description: 'An eight-ounce block of sharp cheddar.' },
  { _id: '66fc0000000000000000010a', name: 'Whole Wheat Bread', category: 'groceries', priceCents: 349, description: 'One sliced 20-ounce whole wheat loaf.' },
  { _id: '66fc0000000000000000010b', name: 'Brown Rice', category: 'groceries', priceCents: 299, description: 'A one-pound bag of dry long-grain brown rice.' },
  { _id: '66fc0000000000000000010c', name: 'Penne Pasta', category: 'groceries', priceCents: 189, description: 'A 16-ounce box of dried penne pasta.' },
  { _id: '66fc0000000000000000010d', name: 'Rolled Oats', category: 'groceries', priceCents: 429, description: 'An 18-ounce container of plain rolled oats.' },
  { _id: '66fc0000000000000000010e', name: 'Canned Chickpeas', category: 'groceries', priceCents: 129, description: 'A 15-ounce can of chickpeas in water.' },
  { _id: '66fc0000000000000000010f', name: 'Olive Oil', category: 'groceries', priceCents: 899, description: 'A 500-milliliter bottle of extra virgin olive oil.' },
  { _id: '66fc00000000000000000110', name: 'Ground Coffee', category: 'groceries', priceCents: 1099, description: 'A twelve-ounce bag of medium-roast ground coffee.' },
  { _id: '66fc00000000000000000111', name: 'Everyday Cooking', category: 'books', priceCents: 1899, description: 'A paperback collection of simple weeknight recipes.' },
  { _id: '66fc00000000000000000112', name: 'Cotton Apron', category: 'clothing', priceCents: 1299, description: 'A washable cotton kitchen apron with two pockets.' },
  { _id: '66fc00000000000000000113', name: 'FreshCart Gift Card', category: 'gift_card', priceCents: 2500, description: 'A demo gift card with a face value of 25 USD. Not redeemable.' },
  { _id: '66fc00000000000000000114', name: 'FreshCart Monthly Box', category: 'subscription', priceCents: 3999, description: 'A demo monthly produce-box listing. No subscription is started.' },
] as const;
