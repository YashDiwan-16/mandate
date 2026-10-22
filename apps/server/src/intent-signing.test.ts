import assert from "node:assert/strict";
import { test } from "node:test";

import { serializeIntent } from "@mandate/api/rules/signature";
import { compilePolicyText } from "@mandate/api/rules/compiler";

import { createIntentSigner } from "./intent-signing";

test("signatures verify an exact intent and reject tampering", () => {
  const rules = compilePolicyText(
    "Groceries up to $80 a week. Ask me before anything over $30 from a new category. Never gift cards or subscriptions.",
    "507f1f77bcf86cd799439011",
  );
  const payload = serializeIntent({
    userId: "507f1f77bcf86cd799439012",
    policyId: "507f1f77bcf86cd799439013",
    version: 1,
    originalWords: "Groceries up to $80 a week.",
    rules,
    signedAt: "2026-10-22T00:00:00.000Z",
  });
  const signer = createIntentSigner("a-demo-signing-key-at-least-32-characters");
  const signature = signer.sign(payload);
  assert.equal(signature, signer.sign(payload));
  assert.equal(signer.verify(payload, signature), true);
  assert.equal(signer.verify(payload.replace("8000", "9000"), signature), false);
  assert.equal(signer.verify(payload, "invalid"), false);
});
