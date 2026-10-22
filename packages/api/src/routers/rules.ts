import { Policy, SignedIntent, Store, type PolicyRecord, type SignedIntentRecord } from "@mandate/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, publicProcedure, router } from "../index";
import { compilePolicyText, compiledRulesSchema, type CompiledRules } from "../rules/compiler";
import { intentPayloadSchema, legacyIntentPayloadSchema, serializeIntent } from "../rules/signature";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const policyInput = z.strictObject({
  originalWords: z.string().trim().min(1).max(2000),
  storeId: objectId,
});

function parsePolicy(originalWords: string, storeId: string, payeeId: string) {
  try {
    return compilePolicyText(originalWords, storeId, payeeId);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Invalid policy",
    });
  }
}

function policyRules(policy: Pick<PolicyRecord, "rules">) {
  return {
    allowedCategories: policy.rules.allowedCategories,
    blockedCategories: policy.rules.blockedCategories,
    allowedStoreId: String(policy.rules.allowedStoreId),
    allowedPayeeId: policy.rules.allowedPayeeId,
    recipientMustBe: policy.rules.recipientMustBe,
    weeklyCapCents: policy.rules.weeklyCapCents,
    askAboveCents: policy.rules.askAboveCents,
    askForNewCategory: policy.rules.askForNewCategory,
  };
}

function requireValidPolicyRules(policy: Pick<PolicyRecord, "rules">): CompiledRules {
  try {
    return compiledRulesSchema.parse(policyRules(policy));
  } catch {
    throw new TRPCError({ code: "CONFLICT", message: "Stored policy rules are invalid" });
  }
}

function validStoredIntent(
  policy: (PolicyRecord & { _id: unknown }) | null,
  intent: SignedIntentRecord,
  signer: Context["intentSigner"],
): boolean {
  if (!policy) return false;
  try {
    const schema = intent.keyId === "v1" ? legacyIntentPayloadSchema : intentPayloadSchema;
    const payload = schema.safeParse(JSON.parse(intent.payload));
    return (
      payload.success &&
      payload.data.userId === String(policy.userId) &&
      payload.data.userId === String(intent.userId) &&
      payload.data.policyId === String(policy._id) &&
      payload.data.policyId === String(intent.policyId) &&
      payload.data.version === policy.version &&
      payload.data.originalWords === policy.originalWords &&
      payload.data.signedAt === policy.confirmedAt.toISOString() &&
      payload.data.signedAt === intent.signedAt.toISOString() &&
      JSON.stringify(payload.data.rules) === JSON.stringify(policyRules(policy)) &&
      signer.verify(intent.payload, intent.signature, intent.keyId)
    );
  } catch {
    return false;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === 11000;
}

function intentResponse(policy: PolicyRecord & { _id: unknown }, intent: SignedIntentRecord & { _id: unknown }) {
  return {
    policyId: String(policy._id),
    intentId: String(intent._id),
    version: policy.version,
    rules: requireValidPolicyRules(policy),
    payload: intent.payload,
    keyId: intent.keyId,
    signature: intent.signature,
  };
}

async function ensureIntent(policy: PolicyRecord & { _id: unknown }, userId: string, signer: Context["intentSigner"]) {
  const rules = requireValidPolicyRules(policy);
  const policyId = String(policy._id);
  let intent = await SignedIntent.findOne({ policyId }).lean();
  if (!intent) {
    const payload = serializeIntent({
      userId,
      policyId,
      version: policy.version,
      originalWords: policy.originalWords,
      rules,
      signedAt: policy.confirmedAt.toISOString(),
      formatVersion: 2,
      currency: "USD",
    });
    try {
      await SignedIntent.create({
        userId,
        policyId,
        payload,
        keyId: signer.keyId,
        signature: signer.sign(payload),
        signedAt: policy.confirmedAt,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
    intent = await SignedIntent.findOne({ policyId }).lean();
  }
  if (!intent || !validStoredIntent(policy, intent, signer)) {
    throw new TRPCError({ code: "CONFLICT", message: "Existing intent failed verification" });
  }
  return intent;
}

async function requireStore(storeId: string) {
  const store = await Store.findById(storeId).lean();
  if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  return store;
}

export const rulesRouter = router({
  verificationKeys: publicProcedure.query(({ ctx }) => ({ keys: [ctx.intentSigner.verificationKey] })),

  preview: protectedProcedure.input(policyInput).mutation(async ({ input }) => {
    const store = await requireStore(input.storeId);
    return parsePolicy(input.originalWords, input.storeId, store.paypalMerchantId);
  }),

  confirm: protectedProcedure
    .input(policyInput.extend({ preview: compiledRulesSchema }))
    .mutation(async ({ ctx, input }) => {
      const store = await requireStore(input.storeId);
      const rules = parsePolicy(input.originalWords, input.storeId, store.paypalMerchantId);
      if (JSON.stringify(rules) !== JSON.stringify(input.preview)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Preview changed; preview the policy again" });
      }

      const userId = ctx.session.user.id;
      const previous = await Policy.findOne({ userId }).sort({ version: -1 });
      if (previous) {
        const previousRules = requireValidPolicyRules(previous);
        const intent = await ensureIntent(previous, userId, ctx.intentSigner);
        if (
          previous.originalWords === input.originalWords &&
          JSON.stringify(previousRules) === JSON.stringify(rules) &&
          intent.keyId !== "v1"
        ) {
          return intentResponse(previous, intent);
        }
      }
      const version = (previous?.version ?? 0) + 1;
      const signedAt = new Date();
      const policy = new Policy({ userId, version, originalWords: input.originalWords, rules, confirmedAt: signedAt });
      try {
        await policy.save();
      } catch (error) {
        if (isDuplicateKey(error)) {
          const winner = await Policy.findOne({ userId, version });
          if (
            winner?.originalWords === input.originalWords &&
            JSON.stringify(requireValidPolicyRules(winner)) === JSON.stringify(rules)
          ) {
            const intent = await ensureIntent(winner, userId, ctx.intentSigner);
            if (intent.keyId !== "v1") return intentResponse(winner, intent);
          }
          throw new TRPCError({ code: "CONFLICT", message: "Policy version changed; try again" });
        }
        throw error;
      }
      // A retry repairs this policy before any newer version can be confirmed.
      const intent = await ensureIntent(policy, userId, ctx.intentSigner);
      return intentResponse(policy, intent);
    }),

  verifyIntent: protectedProcedure.input(z.object({ intentId: objectId })).query(async ({ ctx, input }) => {
    const intent = await SignedIntent.findOne({ _id: input.intentId, userId: ctx.session.user.id }).lean();
    if (!intent) throw new TRPCError({ code: "NOT_FOUND", message: "Intent not found" });
    const policy = await Policy.findById(intent.policyId).lean();
    return { valid: validStoredIntent(policy, intent, ctx.intentSigner) };
  }),
});
