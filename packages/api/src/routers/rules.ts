import { Policy, SignedIntent, Store } from "@mandate/db";
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

function parsePolicy(originalWords: string, storeId: string) {
  try {
    return compilePolicyText(originalWords, storeId);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Invalid policy",
    });
  }
}

async function requireStore(storeId: string) {
  const store = await Store.findById(storeId).lean();
  if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  return store;
}

export const rulesRouter = router({
  preview: protectedProcedure.input(policyInput).mutation(async ({ input }) => {
    await requireStore(input.storeId);
    return parsePolicy(input.originalWords, input.storeId);
  }),

  confirm: protectedProcedure
    .input(policyInput.extend({ preview: compiledRulesSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireStore(input.storeId);
      const rules = parsePolicy(input.originalWords, input.storeId);
      if (JSON.stringify(rules) !== JSON.stringify(input.preview)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Preview changed; preview the policy again" });
      }

      const userId = ctx.session.user.id;
      const previous = await Policy.findOne({ userId }).sort({ version: -1 }).lean();
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
      let intent;
      try {
        intent = await SignedIntent.create({
          userId,
          policyId: policy._id,
          payload,
          keyId: ctx.intentSigner.keyId,
          signature,
          signedAt,
        });
      } catch (error) {
        await policy.deleteOne();
        throw error;
      }
      return { policyId: policy.id, intentId: intent.id, version, rules, signature };
    }),

  verifyIntent: protectedProcedure.input(z.object({ intentId: objectId })).query(async ({ ctx, input }) => {
    const intent = await SignedIntent.findOne({ _id: input.intentId, userId: ctx.session.user.id }).lean();
    if (!intent) throw new TRPCError({ code: "NOT_FOUND", message: "Intent not found" });
    try {
      const payload = intentPayloadSchema.safeParse(JSON.parse(intent.payload));
      return {
        valid:
          payload.success &&
          payload.data.userId === String(intent.userId) &&
          payload.data.policyId === String(intent.policyId) &&
          ctx.intentSigner.verify(intent.payload, intent.signature),
      };
    } catch {
      return { valid: false };
    }
  }),
});
