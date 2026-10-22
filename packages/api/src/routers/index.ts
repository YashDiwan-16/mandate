import { protectedProcedure, publicProcedure, router } from "../index";
import { rulesRouter } from "./rules";

export const appRouter = router({
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
