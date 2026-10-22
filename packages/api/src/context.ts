import type { Session } from "@mandate/auth";
import type { Database } from "@mandate/db";

export type Context = {
  session: Session | null;
  db: Database;
  intentSigner: {
    keyId: string;
    sign(payload: string): string;
    verify(payload: string, signature: string): boolean;
  };
};
