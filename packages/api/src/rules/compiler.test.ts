import assert from "node:assert/strict";
import { test } from "node:test";

import { compilePolicyText, validateCompiledRules } from "./compiler";

const storeId = "507f1f77bcf86cd799439011";
const payeeId = "freshcart-sandbox-merchant";
const text = "Groceries up to $80 a week. Ask me before anything over $30 from a new category. Never gift cards or subscriptions.";

test("compiles a complete plain-English policy", () => {
  assert.deepEqual(compilePolicyText(text, storeId, payeeId), {
    allowedCategories: ["groceries"],
    blockedCategories: ["gift_card", "subscription"],
    allowedStoreId: storeId,
    allowedPayeeId: payeeId,
    recipientMustBe: "store",
    weeklyCapCents: 8000,
    askAboveCents: 3000,
    askForNewCategory: true,
  });
});

test("keeps decimal amounts intact when splitting sentences", () => {
  const decimal = text.replace("$80", "$80.50").replace("$30", "$30.25");
  const rules = compilePolicyText(decimal, storeId, payeeId);
  assert.equal(rules.weeklyCapCents, 8050);
  assert.equal(rules.askAboveCents, 3025);
});

test("rejects malformed structured output", () => {
  assert.throws(() => validateCompiledRules({ allowedCategories: ["groceries"], weeklyCapCents: "80" }));
  assert.throws(() => validateCompiledRules({ ...compilePolicyText(text, storeId, payeeId), extra: "approve all" }));
  assert.throws(() => validateCompiledRules({ ...compilePolicyText(text, storeId, payeeId), recipientMustBe: "anyone" }));
  assert.throws(() => validateCompiledRules({ ...compilePolicyText(text, storeId, payeeId), allowedPayeeId: "   " }));
});

test("rejects missing or unsupported rules", () => {
  assert.throws(() => compilePolicyText("Groceries up to $80 a week.", storeId, payeeId));
  assert.throws(() => compilePolicyText(text.replace("Never gift cards or subscriptions.", ""), storeId, payeeId));
  assert.throws(() => compilePolicyText(`${text} Send a gift to someone else.`, storeId, payeeId));
});
