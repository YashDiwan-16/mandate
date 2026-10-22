import { z } from "zod";
import { policyCategories } from "@mandate/db";

const category = z.enum(policyCategories);
export const compiledRulesSchema = z
  .strictObject({
    allowedCategories: z.array(category).min(1).refine((items) => new Set(items).size === items.length),
    blockedCategories: z.array(category).min(1).refine((items) => new Set(items).size === items.length),
    allowedStoreId: z.string().regex(/^[a-f\d]{24}$/i).transform((id) => id.toLowerCase()),
    allowedPayeeId: z.string().trim().min(1),
    recipientMustBe: z.literal("store"),
    weeklyCapCents: z.number().int().positive().safe(),
    askAboveCents: z.number().int().nonnegative().safe(),
    askForNewCategory: z.boolean(),
  })
  .refine((rules) => rules.askAboveCents <= rules.weeklyCapCents, {
    message: "Approval threshold exceeds weekly cap",
    path: ["askAboveCents"],
  })
  .refine(
    (rules) => !rules.allowedCategories.some((category) => rules.blockedCategories.includes(category)),
    { message: "A category cannot be both allowed and blocked", path: ["blockedCategories"] },
  );

export type CompiledRules = z.infer<typeof compiledRulesSchema>;

export function validateCompiledRules(value: unknown): CompiledRules {
  return compiledRulesSchema.parse(value);
}

const knownCategories: Record<string, string> = {
  grocery: "groceries",
  groceries: "groceries",
  books: "books",
  clothing: "clothing",
  electronics: "electronics",
  "gift card": "gift_card",
  "gift cards": "gift_card",
  subscription: "subscription",
  subscriptions: "subscription",
};

function dollarsToCents(value: string): number {
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function categoriesIn(text: string): string[] {
  const names = text.toLowerCase().split(/\s*(?:,|\band\b|\bor\b)\s*/);
  const categories = names.map((item) => knownCategories[item.trim()]);
  if (categories.some((item) => !item)) throw new Error("Unknown category in policy");
  return [...new Set(categories as string[])];
}

/** Interpret the supported demo grammar; incomplete or unfamiliar clauses fail closed. */
export function compilePolicyText(originalWords: string, allowedStoreId: string, allowedPayeeId: string): CompiledRules {
  const clauses = z.string().trim().min(1).max(2000).parse(originalWords)
    .split(/\.(?!\d)|[!?]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const weekly = clauses.find((clause) => /\b(?:a|per) week\b/i.test(clause));
  const approval = clauses.find((clause) => /\bask me\b/i.test(clause));
  const blocked = clauses.find((clause) => /\bnever\b/i.test(clause));
  if (clauses.length !== 3 || !weekly || !approval || !blocked || clauses.some((c) => ![weekly, approval, blocked].includes(c))) {
    throw new Error("Policy needs a weekly cap, approval rule, and blocked categories");
  }
  const weeklyAmount = weekly.match(/^([a-z ,]+?)\s+(?:up to|maximum|limit(?: of)?)\s*\$(\d+(?:\.\d{1,2})?)\s*(?:a|per) week$/i);
  const approvalAmount = approval.match(/^Ask me before anything over\s*\$(\d+(?:\.\d{1,2})?)\s+from a new category$/i);
  const blockedMatch = blocked.match(/^Never\s+([a-z ,]+)$/i);
  if (!weeklyAmount?.[1] || !weeklyAmount[2] || !approvalAmount?.[1] || !blockedMatch?.[1]) {
    throw new Error("Policy is missing a required rule or uses unsupported wording");
  }
  const allowedCategories = categoriesIn(weeklyAmount[1]);
  const blockedCategories = categoriesIn(blockedMatch[1]);
  return validateCompiledRules({
    allowedCategories,
    blockedCategories,
    allowedStoreId,
    allowedPayeeId,
    recipientMustBe: "store",
    weeklyCapCents: dollarsToCents(weeklyAmount[2]),
    askAboveCents: dollarsToCents(approvalAmount[1]),
    askForNewCategory: true,
  });
}
