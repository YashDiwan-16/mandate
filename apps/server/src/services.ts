import { createAuth } from "@mandate/auth";
import { createDb, Policy, SignedIntent } from "@mandate/db";

import { ENV } from "./env.server";

export const db = await createDb(ENV);
await Promise.all([Policy.init(), SignedIntent.init()]);
export const auth = createAuth(ENV, db);
