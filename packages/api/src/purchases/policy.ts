import { policyCategories } from '@mandate/db';
import { z } from 'zod';

import { compiledRulesSchema } from '../rules/compiler';
import { cartTotalCents, cents, serverPricedCartSchema } from './cart';

const timestamp = z.string().datetime({ offset: true });
const inputSchema = z.strictObject({
  rules: compiledRulesSchema,
  cart: serverPricedCartSchema,
  context: z.strictObject({
    now: timestamp,
    knownCategories: z.array(z.enum(policyCategories)).max(policyCategories.length)
      .refine((items) => new Set(items).size === items.length),
    spending: z.strictObject({
      weekStart: timestamp,
      spentCents: cents,
      reservedCents: cents,
    }),
  }),
});

type Reason = 'INVALID_INPUT' | 'AMOUNT_OVERFLOW' | 'STALE_SPENDING_WINDOW'
  | 'STORE_NOT_ALLOWED' | 'PAYEE_NOT_ALLOWED' | 'CATEGORY_BLOCKED' | 'CATEGORY_NOT_ALLOWED'
  | 'WEEKLY_CAP_EXCEEDED' | 'APPROVAL_THRESHOLD_EXCEEDED' | 'NEW_CATEGORY';

export type PolicyEvaluation = {
  status: 'passed' | 'blocked' | 'approval_required' | 'error';
  reasons: Reason[];
  totalCents: number | null;
};

/** Half-open ISO week: Monday 00:00:00 UTC <= time < next Monday 00:00:00 UTC. */
export function weeklyWindow(at: string) {
  const start = new Date(timestamp.parse(at));
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Read-only decision over trusted server snapshots; never a payment authorization. */
export function evaluatePurchasePolicy(input: unknown): PolicyEvaluation {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: 'error', reasons: ['INVALID_INPUT'], totalCents: null };
  const { rules, cart, context } = parsed.data;
  let totalCents: number;
  try {
    totalCents = cartTotalCents(cart);
  } catch {
    return { status: 'error', reasons: ['AMOUNT_OVERFLOW'], totalCents: null };
  }
  if (new Date(context.spending.weekStart).toISOString() !== weeklyWindow(context.now).start) {
    return { status: 'error', reasons: ['STALE_SPENDING_WINDOW'], totalCents };
  }
  const usedCents = context.spending.spentCents + context.spending.reservedCents;
  if (!Number.isSafeInteger(usedCents) || !Number.isSafeInteger(usedCents + totalCents)) {
    return { status: 'error', reasons: ['AMOUNT_OVERFLOW'], totalCents };
  }
  const categories = [...new Set(cart.items.map((item) => item.category))];
  const blocked: Reason[] = [];
  if (cart.storeId !== rules.allowedStoreId) blocked.push('STORE_NOT_ALLOWED');
  if (cart.payeeId !== rules.allowedPayeeId) blocked.push('PAYEE_NOT_ALLOWED');
  if (categories.some((category) => rules.blockedCategories.includes(category))) blocked.push('CATEGORY_BLOCKED');
  if (categories.some((category) => !rules.allowedCategories.includes(category))) blocked.push('CATEGORY_NOT_ALLOWED');
  if (usedCents + totalCents > rules.weeklyCapCents) blocked.push('WEEKLY_CAP_EXCEEDED');
  if (blocked.length) return { status: 'blocked', reasons: blocked, totalCents };
  const approval: Reason[] = [];
  if (totalCents > rules.askAboveCents) approval.push('APPROVAL_THRESHOLD_EXCEEDED');
  if (rules.askForNewCategory && categories.some((category) => !context.knownCategories.includes(category))) {
    approval.push('NEW_CATEGORY');
  }
  return { status: approval.length ? 'approval_required' : 'passed', reasons: approval, totalCents };
}
