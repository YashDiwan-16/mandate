import { protectedProcedure, publicProcedure, router } from "../index";
import { rulesRouter } from "./rules";
import { catalogRouter } from "./catalog";

export const appRouter = router({
  catalog: catalogRouter,
  rules: rulesRouter,
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
});
export type AppRouter = typeof appRouter;
