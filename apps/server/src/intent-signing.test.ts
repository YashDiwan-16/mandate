import assert from "node:assert/strict";
import { createHmac, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";

import { intentPayloadSchema, serializeIntent } from "@mandate/api/rules/signature";
import { compilePolicyText } from "@mandate/api/rules/compiler";

import { createIntentSigner } from "./intent-signing";

const legacyKey = "a-demo-signing-key-at-least-32-characters";
const privateKey = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

test("a merchant verifies a version-2 intent with only the published public key", () => {
  const rules = compilePolicyText(
    "Groceries up to $80 a week. Ask me before anything over $30 from a new category. Never gift cards or subscriptions.",
    "507f1f77bcf86cd799439011",
    "freshcart-sandbox-merchant",
  );
  const payload = serializeIntent({
    formatVersion: 2,
    currency: "USD",
    userId: "507f1f77bcf86cd799439012",
    policyId: "507f1f77bcf86cd799439013",
    version: 1,
    originalWords: "Groceries up to $80 a week.",
    rules,
    signedAt: "2026-10-22T00:00:00.000Z",
  });
  const signer = createIntentSigner(privateKey, legacyKey);
  const signature = signer.sign(payload);
  assert.equal(signature, signer.sign(payload));
  assert.match(signer.keyId, /^ed25519:[a-f\d]{64}$/);
  assert.equal(signer.verificationKey.kid, signer.keyId);
  assert.equal(signer.verificationKey.alg, "EdDSA");
  const publicKey = createPublicKey({ key: signer.verificationKey, format: "jwk" });
  assert.equal(verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64url")), true);
  const otherPublicKey = generateKeyPairSync("ed25519").publicKey;
  assert.equal(verify(null, Buffer.from(payload), otherPublicKey, Buffer.from(signature, "base64url")), false);
  assert.equal(signer.verify(payload, signature, signer.keyId), true);
  assert.equal(signer.verify(payload.replace("8000", "9000"), signature, signer.keyId), false);
  assert.equal(signer.verify(payload.replace("USD", "EUR"), signature, signer.keyId), false);
  assert.equal(signer.verify(payload, "invalid", signer.keyId), false);
  assert.equal(signer.verify(payload, signature, "ed25519:wrong-key"), false);
  assert.equal(intentPayloadSchema.safeParse({ ...JSON.parse(payload), currency: "EUR" }).success, false);
  assert.equal(intentPayloadSchema.safeParse({ ...JSON.parse(payload), formatVersion: 1 }).success, false);
  assert.throws(() => createIntentSigner("not-base64", legacyKey));
  assert.throws(() => signer.sign('{"not":"an intent"}'));
});

test("legacy HMAC intents remain verifiable but cannot be newly signed", () => {
  // Fixed payload produced by the pre-Ed25519 release; do not derive it from today's serializer.
  const payload = '{"userId":"507f1f77bcf86cd799439012","policyId":"507f1f77bcf86cd799439013","version":1,"originalWords":"Groceries up to $80 a week.","rules":{"allowedCategories":["groceries"],"blockedCategories":["gift_card","subscription"],"allowedStoreId":"507f1f77bcf86cd799439011","allowedPayeeId":"freshcart-sandbox-merchant","recipientMustBe":"store","weeklyCapCents":8000,"askAboveCents":3000,"askForNewCategory":true},"signedAt":"2026-10-22T00:00:00.000Z"}';
  const signature = createHmac("sha256", legacyKey).update(payload, "utf8").digest("hex");
  const signer = createIntentSigner(privateKey, legacyKey);
  assert.equal(signer.verify(payload, signature, "v1"), true);
  assert.equal(signer.verify(payload.replace("8000", "9000"), signature, "v1"), false);
  assert.equal(signer.verify(payload, signature, signer.keyId), false);
});
