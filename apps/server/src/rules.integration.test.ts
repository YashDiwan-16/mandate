import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { appRouter } from "@mandate/api/routers/index";
import type { Context } from "@mandate/api/context";
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
  const signer = createIntentSigner("test-only-intent-signing-key-32-characters");
  const newUserId = () => randomBytes(12).toString("hex");
  const caller = (userId: string) =>
    appRouter.createCaller({
      session: { user: { id: userId } } as Context["session"],
      db,
      intentSigner: signer,
    });

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
    const storedIntent = await SignedIntent.findById(first.intentId).lean();
    assert.equal(JSON.parse(storedIntent!.payload).rules.allowedPayeeId, "sandbox-merchant");
    await Policy.updateOne({ _id: first.policyId }, { $set: { originalWords: "altered" } });
    assert.deepEqual(await api.rules.verifyIntent({ intentId: first.intentId }), { valid: false });
  });

  test("malformed stored intent payload is reported invalid", async () => {
    const api = caller(newUserId());
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    const confirmed = await api.rules.confirm({ originalWords: sample, storeId, preview });
    await SignedIntent.updateOne({ _id: confirmed.intentId }, { $set: { payload: "{" } });
    assert.deepEqual(await api.rules.verifyIntent({ intentId: confirmed.intentId }), { valid: false });
  });

  test("concurrent confirmations cannot reuse a version", async () => {
    const userId = newUserId();
    const api = caller(userId);
    const preview = await api.rules.preview({ originalWords: sample, storeId });
    const input = { originalWords: sample, storeId, preview };
    const results = await Promise.allSettled([api.rules.confirm(input), api.rules.confirm(input)]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
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
    assert.ok(results.some((result) => result.status === "fulfilled"));
    const policies = await Policy.find({ userId }).lean();
    assert.equal(new Set(policies.map((policy) => policy.version)).size, policies.length);
    assert.equal(await SignedIntent.countDocuments({ userId }), policies.length);
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
});
