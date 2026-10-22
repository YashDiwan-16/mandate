import { createHmac, timingSafeEqual } from "node:crypto";

import { serializeIntent } from "@mandate/api/rules/signature";

export function createIntentSigner(key: string) {
  if (key.length < 32) throw new Error("Intent signing key is too short");
  const sign = (payload: string): string => createHmac("sha256", key).update(payload, "utf8").digest("hex");
  const verify = (payload: string, signature: string): boolean => {
    try {
      if (!/^[a-f\d]{64}$/i.test(signature)) return false;
      const expected = Buffer.from(sign(payload), "hex");
      const supplied = Buffer.from(signature, "hex");
      return timingSafeEqual(expected, supplied) && serializeIntent(JSON.parse(payload)) === payload;
    } catch {
      return false;
    }
  };
  return { keyId: "v1", sign, verify };
}
