import { createAuth } from "@mandate/auth";
import { createDb } from "@mandate/db";

import { ENV } from "./env.server";

export const db = await createDb(ENV);
export const auth = createAuth(ENV, db);
