import type { Session } from "@mandate/auth";
import type { Database } from "@mandate/db";

export type Context = {
  session: Session | null;
  db: Database;
  intentSigner: {
    keyId: string;
    verificationKey: {
      kty: "OKP";
      crv: "Ed25519";
      x: string;
      kid: string;
      alg: "EdDSA";
      use: "sig";
    };
    sign(payload: string): string;
    verify(payload: string, signature: string, keyId: string): boolean;
  };
};
