import assert from "node:assert/strict";
import { createHmac, createPublicKey, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { appRouter } from "@mandate/api/routers/index";
import type { Context } from "@mandate/api/context";
import { serializeLegacyIntent } from "@mandate/api/rules/signature";
import { createDb, Policy, SignedIntent, Store, type Database } from "@mandate/db";

import { createIntentSigner } from "./intent-signing";

const sample = "Groceries up to $80 a week. Ask me before anything over $30 from a new category. Never gift cards or subscriptions.";
const testUri = process.env.MANDATE_TEST_MONGODB_URI;
if (process.env.MANDATE_REQUIRE_MONGO === "1" && !testUri) {
  throw new Error("MANDATE_TEST_MONGODB_URI is required for integration tests");
}

describe("rule endpoints against an isolated MongoDB database", { skip: !testUri }, () => {
  let db: Database;
  let storeId: string;
  const legacyKey = "test-only-intent-signing-key-32-characters";
  const privateKey = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const signer = createIntentSigner(privateKey, legacyKey);
  const newUserId = () => randomBytes(12).toString("hex");
  const caller = (userId: string) =>
    appRouter.createCaller({
      session: { user: { id: userId } } as Context["session"],
      db,
      intentSigner: signer,
    });
  const publicCaller = () => appRouter.createCaller({ session: null, db, intentSigner: signer });

  before(async () => {
    const databaseName = `mandate_rules_test_${randomBytes(8).toString("hex")}`;
    db = await createDb({ DATABASE_URL: `${testUri!.replace(/\/$/, "")}/${databaseName}` });
    await Promise.all([Policy.init(), SignedIntent.init(), Store.init()]);
    const store = await Store.create({
      merchantUserId: newUserId(),
      name: "FreshCart",
      slug: `freshcart-${databaseName}`,
      paypalMerchantId: "sandbox-merchant",
    });
    storeId = store.id;
  });

  after(async () => {
    if (db) {
      await db.dropDatabase();
      await db.client.close();
    }
  });

  test("preview requires a real store and confirmation rejects changed rules", async () => {
    const api = caller(newUserId());
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    assert.equal(preview.weeklyCapCents, 8000);
    assert.equal(preview.allowedPayeeId, "sandbox-merchant");
    assert.equal(preview.recipientMustBe, "store");
    await assert.rejects(api.rules.preview({ originalWords: sample, storeId: newUserId() }), /Store not found/);
    await assert.rejects(
      api.rules.confirm({ originalWords: sample, storeId: newUserId(), preview }),
      /Store not found/,
    );
    await assert.rejects(
      api.rules.confirm({ originalWords: sample, storeId, preview: { ...preview, weeklyCapCents: 9000 } }),
      /Preview changed/,
    );
    await assert.rejects(
      api.rules.confirm({ originalWords: sample, storeId, preview: { ...preview, allowedPayeeId: "attacker" } }),
      /Preview changed/,
    );
  });

  test("confirmation rejects a store payee changed after preview", async () => {
    const store = await Store.create({
      merchantUserId: newUserId(),
      name: "Other FreshCart",
      slug: `freshcart-${newUserId()}`,
      paypalMerchantId: "original-payee",
    });
    const api = caller(newUserId());
    const preview = await api.rules.preview({ originalWords: sample, storeId: store.id });
    await Store.updateOne({ _id: store._id }, { $set: { paypalMerchantId: "changed-payee" } });
    await assert.rejects(
      api.rules.confirm({ originalWords: sample, storeId: store.id, preview }),
      /Preview changed/,
    );
  });

  test("policy model rejects invalid direct writes", async () => {
    const rules = await caller(newUserId()).rules.preview({ originalWords: sample, storeId });
    const base = { userId: newUserId(), version: 1, originalWords: sample, confirmedAt: new Date() };
    await assert.rejects(new Policy({ ...base, rules: { ...rules, allowedPayeeId: undefined } }).validate());
    await assert.rejects(new Policy({ ...base, rules: { ...rules, allowedPayeeId: "   " } }).validate());
    await assert.rejects(new Policy({ ...base, rules: { ...rules, recipientMustBe: "anyone" } }).validate());
    await assert.rejects(new Policy({ ...base, rules: { ...rules, allowedCategories: [] } }).validate());
    await assert.rejects(new Policy({ ...base, rules: { ...rules, allowedCategories: ["groceries", "groceries"] } }).validate());
    await assert.rejects(new Policy({ ...base, rules: { ...rules, blockedCategories: ["groceries"] } }).validate());
    await assert.rejects(new Policy({ ...base, rules: { ...rules, askAboveCents: 9000 } }).validate());
    await assert.rejects(new Policy({ ...base, version: 1.5, rules }).validate());
    await assert.rejects(new Policy({ ...base, originalWords: "x".repeat(2001), rules }).validate());
    await assert.rejects(new Policy({ ...base, rules: { ...rules, allowedCategories: ["unknown"] } }).validate());
  });

  test("repeated confirmation returns one policy and a verifiable intent", async () => {
    const userId = newUserId();
    const api = caller(userId);
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    const input = { originalWords: sample, storeId, preview };
    const first = await api.rules.confirm(input);
    const second = await api.rules.confirm(input);
    assert.equal(second.intentId, first.intentId);
    assert.equal(second.version, 1);
    assert.equal(await Policy.countDocuments({ userId }), 1);
    assert.deepEqual(await api.rules.verifyIntent({ intentId: first.intentId }), { valid: true });
    const keys = await publicCaller().rules.verificationKeys();
    assert.equal(keys.keys.length, 1);
    assert.equal(keys.keys[0]?.kid, first.keyId);
    const publicKey = createPublicKey({ key: keys.keys[0]!, format: "jwk" });
    assert.equal(verify(null, Buffer.from(first.payload), publicKey, Buffer.from(first.signature, "base64url")), true);
    const storedIntent = await SignedIntent.findById(first.intentId).lean();
    assert.equal(storedIntent?.payload, first.payload);
    assert.equal(JSON.parse(first.payload).formatVersion, 2);
    assert.equal(JSON.parse(first.payload).currency, "USD");
    assert.equal(JSON.parse(storedIntent!.payload).rules.allowedPayeeId, "sandbox-merchant");
    await Policy.updateOne({ _id: first.policyId }, { $set: { originalWords: "altered" } });
    assert.deepEqual(await api.rules.verifyIntent({ intentId: first.intentId }), { valid: false });
  });

  test("uppercase store IDs still confirm idempotently", async () => {
    const userId = newUserId();
    const api = caller(userId);
    const uppercaseStoreId = storeId.toUpperCase();
    const preview = await api.rules.preview({ originalWords: sample, storeId: uppercaseStoreId });
    assert.equal(preview.allowedStoreId, storeId);
    const input = { originalWords: sample, storeId: uppercaseStoreId, preview };
    const first = await api.rules.confirm(input);
    const second = await api.rules.confirm(input);
    assert.equal(first.intentId, second.intentId);
    assert.equal(await Policy.countDocuments({ userId }), 1);
    assert.deepEqual(await api.rules.verifyIntent({ intentId: first.intentId }), { valid: true });
  });

  test("a legacy intent stays verifiable and re-confirmation upgrades the proof", async () => {
    const userId = newUserId();
    const api = caller(userId);
    const rules = await api.rules.preview({ originalWords: sample, storeId });
    const confirmedAt = new Date();
    const policy = await Policy.create({ userId, version: 1, originalWords: sample, rules, confirmedAt });
    const payload = serializeLegacyIntent({
      userId, policyId: policy.id, version: 1, originalWords: sample, rules, signedAt: confirmedAt.toISOString(),
    });
    const oldIntent = await SignedIntent.create({
      userId, policyId: policy._id, payload, keyId: "v1",
      signature: createHmac("sha256", legacyKey).update(payload).digest("hex"), signedAt: confirmedAt,
    });
    assert.deepEqual(await api.rules.verifyIntent({ intentId: oldIntent.id }), { valid: true });
    const upgraded = await api.rules.confirm({ originalWords: sample, storeId, preview: rules });
    assert.equal(upgraded.version, 2);
    assert.match(upgraded.keyId, /^ed25519:/);
    assert.deepEqual(await api.rules.verifyIntent({ intentId: upgraded.intentId }), { valid: true });
    assert.deepEqual(await api.rules.verifyIntent({ intentId: oldIntent.id }), { valid: true });
  });

  test("malformed stored intent payload is reported invalid", async () => {
    const api = caller(newUserId());
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    const confirmed = await api.rules.confirm({ originalWords: sample, storeId, preview });
    await SignedIntent.updateOne({ _id: confirmed.intentId }, { $set: { payload: "{" } });
    assert.deepEqual(await api.rules.verifyIntent({ intentId: confirmed.intentId }), { valid: false });
    await assert.rejects(api.rules.confirm({ originalWords: sample, storeId, preview }), /Existing intent failed verification/);
  });

  test("malformed stored policy fails closed", async () => {
    const api = caller(newUserId());
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    const confirmed = await api.rules.confirm({ originalWords: sample, storeId, preview });
    await Policy.updateOne({ _id: confirmed.policyId }, { $set: { "rules.weeklyCapCents": -1 } });
    assert.deepEqual(await api.rules.verifyIntent({ intentId: confirmed.intentId }), { valid: false });
    await assert.rejects(api.rules.confirm({ originalWords: sample, storeId, preview }), /Stored policy rules are invalid/);
  });

  test("concurrent identical confirmations return the same policy and intent", async () => {
    const userId = newUserId();
    const api = caller(userId);
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    const input = { originalWords: sample, storeId, preview };
    const results = await Promise.allSettled([api.rules.confirm(input), api.rules.confirm(input)]);
    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(results[1]?.status, "fulfilled");
    if (results[0]?.status !== "fulfilled" || results[1]?.status !== "fulfilled") return;
    assert.equal(results[0].value.intentId, results[1].value.intentId);
    assert.equal(results[0].value.version, 1);
    assert.equal(await Policy.countDocuments({ userId }), 1);
    assert.equal(await SignedIntent.countDocuments({ userId }), 1);
  });

  test("different concurrent policies cannot share a version", async () => {
    const userId = newUserId();
    const api = caller(userId);
    const other = sample.replace("$80", "$90");
    const [firstPreview, otherPreview] = await Promise.all([
      api.rules.preview({ originalWords: sample, storeId }),
      api.rules.preview({ originalWords: other, storeId }),
    ]);
    const results = await Promise.allSettled([
      api.rules.confirm({ originalWords: sample, storeId, preview: firstPreview }),
      api.rules.confirm({ originalWords: other, storeId, preview: otherPreview }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    assert.ok(fulfilled.length >= 1);
    const conflicts = results.filter((result) => result.status === "rejected");
    for (const conflict of conflicts) assert.equal(conflict.reason.code, "CONFLICT");
    const policies = await Policy.find({ userId }).lean();
    assert.equal(new Set(policies.map((policy) => policy.version)).size, policies.length);
    assert.equal(await SignedIntent.countDocuments({ userId }), policies.length);
    if (conflicts.length) {
      const losingInput = results[0]?.status === "rejected"
        ? { originalWords: sample, storeId, preview: firstPreview }
        : { originalWords: other, storeId, preview: otherPreview };
      const retried = await api.rules.confirm(losingInput);
      assert.equal(retried.version, 2);
      assert.deepEqual(await api.rules.verifyIntent({ intentId: retried.intentId }), { valid: true });
    } else {
      assert.deepEqual(policies.map((policy) => policy.version).sort(), [1, 2]);
    }
  });

  test("an intent write failure can be repaired by retrying confirmation", async () => {
    const userId = newUserId();
    const api = caller(userId);
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    const input = { originalWords: sample, storeId, preview };
    const originalCreate = SignedIntent.create;
    SignedIntent.create = (async () => { throw new Error("injected insert failure"); }) as typeof SignedIntent.create;
    try {
      await assert.rejects(api.rules.confirm(input), /injected insert failure/);
    } finally {
      SignedIntent.create = originalCreate;
    }
    assert.equal(await Policy.countDocuments({ userId }), 1);
    assert.equal(await SignedIntent.countDocuments({ userId }), 0);
    const retried = await api.rules.confirm(input);
    assert.equal(retried.version, 1);
    assert.deepEqual(await api.rules.verifyIntent({ intentId: retried.intentId }), { valid: true });
  });

  test("a different confirmation repairs a pending intent before creating a newer policy", async () => {
    const userId = newUserId();
    const api = caller(userId);
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    const input = { originalWords: sample, storeId, preview };
    const originalCreate = SignedIntent.create;
    SignedIntent.create = (async () => { throw new Error("injected insert failure"); }) as typeof SignedIntent.create;
    try {
      await assert.rejects(api.rules.confirm(input), /injected insert failure/);
    } finally {
      SignedIntent.create = originalCreate;
    }
    const other = sample.replace("$80", "$90");
    const otherPreview = await api.rules.preview({ originalWords: other, storeId });
    const newer = await api.rules.confirm({ originalWords: other, storeId, preview: otherPreview });
    assert.equal(newer.version, 2);
    assert.equal(await Policy.countDocuments({ userId }), 2);
    assert.equal(await SignedIntent.countDocuments({ userId }), 2);
    const repaired = await SignedIntent.findOne({ userId, policyId: { $ne: newer.policyId } }).lean();
    assert.ok(repaired);
    assert.deepEqual(await api.rules.verifyIntent({ intentId: String(repaired._id) }), { valid: true });
  });
});
