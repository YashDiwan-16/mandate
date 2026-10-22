# Deterministic purchase policy checks

`@mandate/api/purchases/policy` exports `evaluatePurchasePolicy(input)` and
`weeklyWindow(at)`. The evaluator is pure: all time, prices, spending and category
history are explicit inputs. It does not use the clock, mutate inputs, access
MongoDB, call a model or make PayPal/HTTP calls. It returns a fresh object with
`status`, `reasons` (stable codes), and `totalCents`.

The internal server helper `@mandate/api/purchases/pricing` exports
`priceCart(request)`. It reads Store and active Product records from MongoDB.
Its only shopper-supplied fields are `storeId` and `items: [{ productId, quantity }]`.
Extra fields, including recipient, price, category, total, and approval flags,
are rejected. No purchase endpoint is exposed by this step.

## Exact rules

| Condition | Result |
| --- | --- |
| Store differs from `allowedStoreId` | Block |
| Current store payee differs from `allowedPayeeId` | Block |
| Any item is in `blockedCategories` | Block entire cart |
| Any item is outside `allowedCategories` | Block entire cart |
| Spent + reserved + cart total is greater than `weeklyCapCents` | Block |
| Cart total is strictly greater than `askAboveCents` | Require approval, even in a known category |
| `askForNewCategory` and any otherwise allowed category is new | Require approval, at any amount |
| No blocking or approval condition | Pass this check |

The two approval conditions use **OR**, not AND. With a $30 threshold, $30.00
does not trigger the amount condition; $30.01 does, even for familiar groceries.
A newly allowed book at $0.01 also requires approval when the new-category flag
is set. Approval never overrides a blocked category, store, recipient or cap.
Turning off `askForNewCategory` does not turn off the amount threshold. This is
the explicit conservative interpretation of the compiler's separate structured
fields, including policies worded "over $30 from a new category".

`context.knownCategories` must come from trusted successful purchase history for
this shopper at this store, across all time. It is not reset every week. Failed,
cancelled, pending and merely approved purchases do not establish familiarity.
First purchases can therefore require approval even in the policy's allowlist.
The evaluator never derives category or permissions from a description/name.

## Money and time

All monetary inputs are nonnegative safe integer USD cents. Quantities are positive
safe integers, never coerced from strings. Empty carts, duplicate product IDs,
unsupported currencies, unknown fields/categories, and invalid policies fail
closed. Line multiplication, cart summation and spending summation must all stay
within `Number.MAX_SAFE_INTEGER`. At most 100 distinct products are accepted.

The demo total is the sum of current unit prices times quantities. This step has
no taxes, shipping, currency conversion, or other extra charges. Supporting those
requires explicitly including their trusted amounts in checks before any future
payment; they cannot be supplied as unchecked client fields.

A week is **Monday 00:00:00.000 UTC inclusive to next Monday exclusive**. Offset
timestamps are interpreted as instants in UTC. For example, `2026-10-26T01:00:00+05:30`
is still in the week beginning `2026-10-19T00:00:00.000Z`.
`context.now` is a trusted server timestamp, passed explicitly for repeatable tests.
`context.spending.weekStart` must identify the exact Monday boundary containing
that timestamp; an old or future weekly snapshot returns `STALE_SPENDING_WINDOW`.

`context.spending.spentCents` is the shopper's completed/captured spending in that
week across policy versions. A policy edit must not reset the budget. Refunds do
not restore the demo's weekly capacity. `reservedCents` includes outstanding
holds for concurrent purchases, including any approval-pending requests that a
future execution flow reserves. Neither balance may be accepted from the shopper.
At rollover, existing holds remain charged to their original week; an execution
attempt in a new week must reprice, recheck, and acquire capacity for that week.

## Concurrency and authority

`passed` is a read-only policy check, **not a spend reservation or authorization**.
This module does not persist purchase/approval records or implement spending.
Two parallel evaluations against the same snapshot can both pass. Tests preserve
that limitation explicitly; a pure function cannot serialize database writes.

Any future purchase executor must load the authenticated shopper's current
confirmed and verified policy, current catalog prices/payee and trusted spending
snapshot; evaluate; and atomically compare-and-reserve capacity before payment.
Use a database transaction or conditional update with a revision/cap guard, include
all outstanding reservations, and retry evaluation after a conflict. An approval
must be tied to the specific priced cart, recipient, policy and amount, then
rechecked before reserving/executing. Never execute using a preview result alone.
The real atomic reservation/execution boundary is **not implemented in this step**.

`priceCart` returns a point-in-time snapshot, not a price or recipient lock.
Re-running it observes price/activity/payee changes; do so again before future
execution. Raw wallet tokens, descriptions, client prices and caller-selected
recipient overrides have no role in this evaluator. A pass for the seeded demo
merchant placeholder does not establish a usable PayPal account.

## Server usage

```typescript
import { priceCart } from '@mandate/api/purchases/pricing';
import { evaluatePurchasePolicy, weeklyWindow } from '@mandate/api/purchases/policy';

// Call inside authenticated server code. Load these values from trusted storage.
const cart = await priceCart({ storeId, items: [{ productId, quantity: 2 }] });
const now = serverTimestamp;
const decision = evaluatePurchasePolicy({
  rules: verifiedConfirmedRules,
  cart,
  context: {
    now,
    knownCategories: successfulPurchaseCategories,
    spending: {
      weekStart: weeklyWindow(now).start,
      spentCents: trustedWeeklyCapturedCents,
      reservedCents: trustedWeeklyHeldCents,
    },
  },
});
// decision alone cannot be used to execute a payment.
```

Invalid input/arithmetic/stale context returns `error`; hard failures return
`blocked` and suppress approval reasons. Otherwise the result is `approval_required`
or `passed`. Never treat `error` as permission, and do not catch a `priceCart`
validation/lookup failure by falling back to a shopper-supplied cart.

Tests:

```bash
pnpm --filter @mandate/api test
MANDATE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017 pnpm --filter server test:integration
```
