import { z } from "zod";

import { compiledRulesSchema } from "./compiler";

export const legacyIntentPayloadSchema = z.strictObject({
  userId: z.string().regex(/^[a-f\d]{24}$/i),
  policyId: z.string().regex(/^[a-f\d]{24}$/i),
  version: z.number().int().positive(),
  originalWords: z.string().min(1),
  rules: compiledRulesSchema,
  signedAt: z.string().datetime(),
});

export const intentPayloadSchema = legacyIntentPayloadSchema.extend({
  formatVersion: z.literal(2),
  currency: z.literal("USD"),
});

export type IntentPayload = z.infer<typeof intentPayloadSchema>;

export function serializeIntent(payload: IntentPayload): string {
  return JSON.stringify(intentPayloadSchema.parse(payload));
}

export function serializeLegacyIntent(payload: z.infer<typeof legacyIntentPayloadSchema>): string {
  return JSON.stringify(legacyIntentPayloadSchema.parse(payload));
}
