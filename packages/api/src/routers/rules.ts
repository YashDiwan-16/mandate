import { Policy, SignedIntent, Store, type PolicyRecord, type SignedIntentRecord } from "@mandate/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { compilePolicyText, compiledRulesSchema } from "../rules/compiler";
import { intentPayloadSchema, serializeIntent } from "../rules/signature";

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

function validStoredIntent(
  policy: (PolicyRecord & { _id: unknown }) | null,
  intent: SignedIntentRecord,
  signer: { keyId: string; verify(payload: string, signature: string): boolean },
): boolean {
  if (!policy || intent.keyId !== signer.keyId) return false;
  try {
    const payload = intentPayloadSchema.safeParse(JSON.parse(intent.payload));
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
      signer.verify(intent.payload, intent.signature)
    );
  } catch {
    return false;
  }
}

async function requireStore(storeId: string) {
  const store = await Store.findById(storeId).lean();
  if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  return store;
}

export const rulesRouter = router({
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
      if (
        previous?.originalWords === input.originalWords &&
        JSON.stringify(policyRules(previous)) === JSON.stringify(rules)
      ) {
        let intent = await SignedIntent.findOne({ policyId: previous._id });
        if (!intent) {
          const payload = serializeIntent({
            userId,
            policyId: previous.id,
            version: previous.version,
            originalWords: previous.originalWords,
            rules,
            signedAt: previous.confirmedAt.toISOString(),
          });
          intent = await SignedIntent.create({
            userId,
            policyId: previous._id,
            payload,
            keyId: ctx.intentSigner.keyId,
            signature: ctx.intentSigner.sign(payload),
            signedAt: previous.confirmedAt,
          });
        }
        if (!validStoredIntent(previous, intent, ctx.intentSigner)) {
          throw new TRPCError({ code: "CONFLICT", message: "Existing intent failed verification" });
        }
        return {
          policyId: previous.id,
          intentId: intent.id,
          version: previous.version,
          rules,
          signature: intent.signature,
        };
      }
      const version = (previous?.version ?? 0) + 1;
      const signedAt = new Date();
      const policy = new Policy({ userId, version, originalWords: input.originalWords, rules, confirmedAt: signedAt });
      const payload = serializeIntent({
        userId,
        policyId: policy.id,
        version,
        originalWords: input.originalWords,
        rules,
        signedAt: signedAt.toISOString(),
      });
      const signature = ctx.intentSigner.sign(payload);
      try {
        await policy.save();
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 11000) {
          throw new TRPCError({ code: "CONFLICT", message: "Policy version changed; try again" });
        }
        throw error;
      }
      // Keep the policy if this write fails; a retry completes the same version.
      const intent = await SignedIntent.create({
        userId,
        policyId: policy._id,
        payload,
        keyId: ctx.intentSigner.keyId,
        signature,
        signedAt,
      });
      return { policyId: policy.id, intentId: intent.id, version, rules, signature };
    }),

  verifyIntent: protectedProcedure.input(z.object({ intentId: objectId })).query(async ({ ctx, input }) => {
    const intent = await SignedIntent.findOne({ _id: input.intentId, userId: ctx.session.user.id }).lean();
    if (!intent) throw new TRPCError({ code: "NOT_FOUND", message: "Intent not found" });
    const policy = await Policy.findById(intent.policyId).lean();
    return { valid: validStoredIntent(policy, intent, ctx.intentSigner) };
  }),
});
