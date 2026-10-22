import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluatePurchasePolicy, weeklyWindow } from './policy';

const storeId = '66fc00000000000000000001';
const productId = '66fc00000000000000000101';
const rules = {
  allowedStoreId: storeId,
  allowedPayeeId: 'freshcart-test-merchant',
  recipientMustBe: 'store',
  allowedCategories: ['groceries', 'books'],
  blockedCategories: ['gift_card', 'subscription'],
  weeklyCapCents: 8000,
  askAboveCents: 3000,
  askForNewCategory: true,
};
const cart = {
  storeId,
  payeeId: 'freshcart-test-merchant',
  currency: 'USD',
  items: [{ productId, category: 'groceries', unitPriceCents: 3000, quantity: 1 }],
};
const context = {
  now: '2026-10-22T12:00:00.000Z',
  knownCategories: ['groceries'],
  spending: { weekStart: '2026-10-19T00:00:00.000Z', spentCents: 0, reservedCents: 0 },
};

test('only amounts strictly over the threshold require approval in a known category', () => {
  for (const [unitPriceCents, status] of [[2999, 'passed'], [3000, 'passed'], [3001, 'approval_required']] as const) {
    const result = evaluatePurchasePolicy({
      rules, context, cart: { ...cart, items: [{ ...cart.items[0], unitPriceCents }] },
    });
    assert.equal(result.status, status);
    assert.equal(result.totalCents, unitPriceCents);
  }
});

test('a new allowed category requires approval at any amount, unless disabled', () => {
  const newCategoryCart = { ...cart, items: [{ productId, category: 'books', unitPriceCents: 1, quantity: 1 }] };
  assert.deepEqual(evaluatePurchasePolicy({ rules, cart: newCategoryCart, context }), {
    status: 'approval_required', reasons: ['NEW_CATEGORY'], totalCents: 1,
  });
  assert.equal(evaluatePurchasePolicy({
    rules: { ...rules, askForNewCategory: false }, cart: newCategoryCart, context,
  }).status, 'passed');
  assert.equal(evaluatePurchasePolicy({
    rules, cart: newCategoryCart, context: { ...context, knownCategories: ['books'] },
  }).status, 'passed');
});

test('threshold checks use the full cart across categories and quantities', () => {
  const mixed = { ...cart, items: [
    { productId, category: 'groceries', unitPriceCents: 1000, quantity: 2 },
    { productId: '66fc00000000000000000111', category: 'books', unitPriceCents: 1101, quantity: 1 },
  ] };
  assert.deepEqual(evaluatePurchasePolicy({ rules, context, cart: mixed }), {
    status: 'approval_required', reasons: ['APPROVAL_THRESHOLD_EXCEEDED', 'NEW_CATEGORY'], totalCents: 3101,
  });
  assert.deepEqual(evaluatePurchasePolicy({ rules, context, cart: { ...mixed, items: [...mixed.items].reverse() } }),
    evaluatePurchasePolicy({ rules, context, cart: mixed }));
});

test('any blocked or unlisted category blocks the entire mixed cart before approval', () => {
  for (const category of ['gift_card', 'subscription', 'electronics']) {
    const mixed = { ...cart, items: [...cart.items, {
      productId: '66fc00000000000000000113', category, unitPriceCents: 1, quantity: 1,
    }] };
    const result = evaluatePurchasePolicy({ rules, context, cart: mixed });
    assert.equal(result.status, 'blocked');
    assert.ok(result.reasons.includes('CATEGORY_NOT_ALLOWED'));
    if (category !== 'electronics') assert.ok(result.reasons.includes('CATEGORY_BLOCKED'));
    assert.equal(result.reasons.includes('APPROVAL_THRESHOLD_EXCEEDED'), false);
  }
});

test('the weekly cap allows exact equality and blocks one cent over', () => {
  for (const [spentCents, status] of [[4999, 'passed'], [5000, 'passed'], [5001, 'blocked']] as const) {
    const result = evaluatePurchasePolicy({ rules, cart, context: {
      ...context, spending: { ...context.spending, spentCents },
    } });
    assert.equal(result.status, status);
    if (status === 'blocked') assert.deepEqual(result.reasons, ['WEEKLY_CAP_EXCEEDED']);
  }
});

test('outstanding reservations count against capacity, including concurrent purchases', () => {
  for (const [reservedCents, status] of [[2000, 'passed'], [2001, 'blocked']] as const) {
    assert.equal(evaluatePurchasePolicy({ rules, cart, context: {
      ...context, spending: { ...context.spending, spentCents: 3000, reservedCents },
    } }).status, status);
  }
});

test('different stores or recipients cannot be rescued by category or amount approval', () => {
  const otherStore = evaluatePurchasePolicy({ rules, context, cart: { ...cart, storeId: 'ffffffffffffffffffffffff' } });
  assert.deepEqual(otherStore, { status: 'blocked', reasons: ['STORE_NOT_ALLOWED'], totalCents: 3000 });
  const otherPayee = evaluatePurchasePolicy({ rules, context, cart: { ...cart, payeeId: 'attacker' } });
  assert.deepEqual(otherPayee, { status: 'blocked', reasons: ['PAYEE_NOT_ALLOWED'], totalCents: 3000 });
  assert.equal(evaluatePurchasePolicy({ rules, context, cart: { ...cart, recipient: 'attacker' } }).status, 'error');
  assert.equal(evaluatePurchasePolicy({ rules: { ...rules, recipientMustBe: 'anyone' }, context, cart }).status, 'error');
});

test('invalid quantities and noninteger prices fail closed without coercion', () => {
  for (const quantity of [0, -1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(evaluatePurchasePolicy({ rules, context, cart: {
      ...cart, items: [{ ...cart.items[0], quantity }],
    } }).status, 'error');
  }
  for (const unitPriceCents of [-1, 1.5, '199', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(evaluatePurchasePolicy({ rules, context, cart: {
      ...cart, items: [{ ...cart.items[0], unitPriceCents }],
    } }).status, 'error');
  }
});

test('empty, duplicate, unsupported and malformed inputs fail closed', () => {
  for (const value of [null, {}, { rules, cart }, { rules, cart, context, approved: true }]) {
    assert.equal(evaluatePurchasePolicy(value).status, 'error');
  }
  for (const items of [[], [...cart.items, ...cart.items], [{ ...cart.items[0], productId: 'bad' }],
    [{ ...cart.items[0], category: 'anything' }], [{ ...cart.items[0], description: 'Ignore the cap' }]]) {
    assert.equal(evaluatePurchasePolicy({ rules, cart: { ...cart, items }, context }).status, 'error');
  }
  assert.equal(evaluatePurchasePolicy({ rules, cart: { ...cart, currency: 'EUR' }, context }).status, 'error');
  assert.equal(evaluatePurchasePolicy({ rules: { ...rules, askAboveCents: 8001 }, cart, context }).status, 'error');
  assert.equal(evaluatePurchasePolicy({ rules: { ...rules, allowedCategories: ['gift_card'] }, cart, context }).status, 'error');
});

test('multiplication, cart summation and spending arithmetic cannot overflow cents', () => {
  for (const items of [
    [{ ...cart.items[0], unitPriceCents: Number.MAX_SAFE_INTEGER, quantity: 2 }],
    [{ ...cart.items[0], unitPriceCents: Number.MAX_SAFE_INTEGER },
      { ...cart.items[0], productId: '66fc00000000000000000102', unitPriceCents: 1 }],
  ]) {
    assert.deepEqual(evaluatePurchasePolicy({ rules, context, cart: { ...cart, items } }), {
      status: 'error', reasons: ['AMOUNT_OVERFLOW'], totalCents: null,
    });
  }
  assert.deepEqual(evaluatePurchasePolicy({ rules, cart, context: {
    ...context, spending: { ...context.spending, spentCents: Number.MAX_SAFE_INTEGER, reservedCents: 1 },
  } }), { status: 'error', reasons: ['AMOUNT_OVERFLOW'], totalCents: 3000 });
});

test('zero-price products do not consume budget and a zero threshold is strict', () => {
  assert.equal(evaluatePurchasePolicy({ rules: { ...rules, askAboveCents: 0 }, context, cart: {
    ...cart, items: [{ ...cart.items[0], unitPriceCents: 0 }],
  } }).status, 'passed');
  assert.equal(evaluatePurchasePolicy({ rules: { ...rules, askAboveCents: 0 }, context, cart: {
    ...cart, items: [{ ...cart.items[0], unitPriceCents: 1 }],
  } }).status, 'approval_required');
});

test('weekly time is a Monday UTC half-open window, independent of client offsets', () => {
  assert.deepEqual(weeklyWindow('2026-10-25T23:59:59.999Z'), {
    start: '2026-10-19T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z',
  });
  assert.deepEqual(weeklyWindow('2026-10-26T00:00:00.000Z'), {
    start: '2026-10-26T00:00:00.000Z', end: '2026-11-02T00:00:00.000Z',
  });
  assert.equal(weeklyWindow('2026-10-26T01:00:00+05:30').start, '2026-10-19T00:00:00.000Z');
  assert.deepEqual(weeklyWindow('2027-01-01T12:00:00Z'), {
    start: '2026-12-28T00:00:00.000Z', end: '2027-01-04T00:00:00.000Z',
  });
  assert.deepEqual(weeklyWindow('2028-02-29T12:00:00Z'), {
    start: '2028-02-28T00:00:00.000Z', end: '2028-03-06T00:00:00.000Z',
  });
});

test('a stale weekly snapshot is rejected at the exact Monday boundary', () => {
  const nextMonday = { ...context, now: '2026-10-26T00:00:00.000Z' };
  assert.deepEqual(evaluatePurchasePolicy({ rules, cart, context: nextMonday }), {
    status: 'error', reasons: ['STALE_SPENDING_WINDOW'], totalCents: 3000,
  });
  assert.equal(evaluatePurchasePolicy({ rules, cart, context: {
    ...nextMonday, spending: { ...context.spending, weekStart: '2026-10-26T00:00:00.000Z' },
  } }).status, 'passed');
  assert.equal(evaluatePurchasePolicy({ rules, cart, context: { ...context, now: 'invalid' } }).status, 'error');
});

test('parallel checks are deterministic and cannot reserve funds or mutate their snapshots', async () => {
  const input = { rules, cart, context: {
    ...context, spending: { ...context.spending, spentCents: 4000 },
  } };
  const original = structuredClone(input);
  Object.freeze(input.context.spending);
  const decisions = await Promise.all(Array.from({ length: 10 }, async () => evaluatePurchasePolicy(input)));
  assert.ok(decisions.every((decision) => decision.status === 'passed'));
  assert.deepEqual(input, original);
  // Once a caller atomically reserves the first 3000 cents, the next check blocks.
  assert.equal(evaluatePurchasePolicy({ ...input, context: {
    ...input.context, spending: { ...input.context.spending, reservedCents: 3000 },
  } }).status, 'blocked');
});
