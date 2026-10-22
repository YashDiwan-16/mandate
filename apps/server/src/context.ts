import type { Context as ApiContext } from "@mandate/api/context";
import type { Context as HonoContext } from "hono";

import { db } from "./services";
import { auth } from "./services";
import { ENV } from "./env.server";
import { createIntentSigner } from "./intent-signing";

const intentSigner = createIntentSigner(ENV.INTENT_ED25519_PRIVATE_KEY, ENV.INTENT_SIGNING_KEY);

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    db,
    session,
    intentSigner,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
