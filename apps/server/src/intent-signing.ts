import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as signEd25519,
  timingSafeEqual,
  verify as verifyEd25519,
} from "node:crypto";

import { serializeIntent, serializeLegacyIntent } from "@mandate/api/rules/signature";

export function createIntentSigner(privateKeyBase64: string, legacyKey: string) {
  if (legacyKey.length < 32) throw new Error("Legacy intent signing key is too short");
  if (!/^[A-Za-z\d+/]+={0,2}$/.test(privateKeyBase64)) throw new Error("Invalid Ed25519 private key encoding");
  const privateKeyBytes = Buffer.from(privateKeyBase64, "base64");
  if (privateKeyBytes.toString("base64") !== privateKeyBase64) throw new Error("Invalid Ed25519 private key encoding");
  const privateKey = createPrivateKey({ key: privateKeyBytes, format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Intent private key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${createHash("sha256").update(publicDer).digest("hex")}`;
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x) throw new Error("Ed25519 public key is missing x");
  const verificationKey = { kty: "OKP", crv: "Ed25519", x: jwk.x, kid: keyId, alg: "EdDSA", use: "sig" } as const;
  const canonicalIntent = (payload: string): boolean => serializeIntent(JSON.parse(payload)) === payload;
  const sign = (payload: string): string => {
    if (!canonicalIntent(payload)) throw new Error("Intent payload is not canonical version 2 JSON");
    return signEd25519(null, Buffer.from(payload, "utf8"), privateKey).toString("base64url");
  };
  const verify = (payload: string, signature: string, signedKeyId: string): boolean => {
    try {
      if (signedKeyId === "v1") {
        if (!/^[a-f\d]{64}$/i.test(signature)) return false;
        const expected = createHmac("sha256", legacyKey).update(payload, "utf8").digest();
        const supplied = Buffer.from(signature, "hex");
        return timingSafeEqual(expected, supplied) && serializeLegacyIntent(JSON.parse(payload)) === payload;
      }
      if (signedKeyId !== keyId || !/^[A-Za-z\d_-]+$/.test(signature)) return false;
      const supplied = Buffer.from(signature, "base64url");
      return supplied.length === 64 && supplied.toString("base64url") === signature &&
        canonicalIntent(payload) &&
        verifyEd25519(null, Buffer.from(payload, "utf8"), publicKey, supplied);
    } catch {
      return false;
    }
  };
  return { keyId, verificationKey, sign, verify };
}
