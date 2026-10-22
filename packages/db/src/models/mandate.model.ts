import mongoose, { type InferSchemaType } from "mongoose";

const { Schema, model } = mongoose;
const { ObjectId } = Schema.Types;
const nonnegativeCents = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
export const policyCategories = ["groceries", "books", "clothing", "electronics", "gift_card", "subscription"] as const;
const policyCategorySet = new Set<string>(policyCategories);
const validCategories = (categories: string[]) =>
  categories.length > 0 &&
  categories.every((category) => policyCategorySet.has(category)) &&
  new Set(categories).size === categories.length;

export const purchaseRequestStatuses = [
  "requested",
  "blocked",
  "awaiting_approval",
  "approved",
  "completed",
  "cancelled",
  "failed",
] as const;
export type PurchaseRequestStatus = (typeof purchaseRequestStatuses)[number];

export const policyCheckStatuses = ["passed", "blocked", "approval_required", "error"] as const;
export type PolicyCheckStatus = (typeof policyCheckStatuses)[number];

export const approvalStatuses = ["pending", "approved", "declined", "expired"] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const paypalPaymentStates = [
  "not_started",
  "authorized",
  "captured",
  "voided",
  "failed",
] as const;
export type PayPalPaymentState = (typeof paypalPaymentStates)[number];

export const disputeStatuses = [
  "received",
  "evidence_ready",
  "evidence_submitted",
  "resolved",
  "failed",
] as const;
export type DisputeStatus = (typeof disputeStatuses)[number];

const policyRulesSchema = new Schema(
  {
    allowedCategories: { type: [String], required: true, validate: validCategories },
    blockedCategories: { type: [String], required: true, validate: validCategories },
    allowedStoreId: { type: ObjectId, ref: "Store", required: true },
    allowedPayeeId: { type: String, required: true, trim: true },
    recipientMustBe: { type: String, required: true, enum: ["store"] },
    weeklyCapCents: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    askAboveCents: nonnegativeCents,
    askForNewCategory: { type: Boolean, required: true },
  },
  { _id: false },
);
policyRulesSchema.pre("validate", function () {
  if (this.askAboveCents > this.weeklyCapCents) {
    this.invalidate("askAboveCents", "Approval threshold exceeds weekly cap");
  }
  if (this.allowedCategories.some((category) => this.blockedCategories.includes(category))) {
    this.invalidate("blockedCategories", "A category cannot be both allowed and blocked");
  }
});
export type PolicyRules = InferSchemaType<typeof policyRulesSchema>;

const policySchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    version: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    originalWords: { type: String, required: true, trim: true, maxlength: 2000 },
    rules: { type: policyRulesSchema, required: true },
    confirmedAt: { type: Date, required: true },
  },
  { collection: "policies", timestamps: true },
);
policySchema.index({ userId: 1, version: 1 }, { unique: true });
export type PolicyRecord = InferSchemaType<typeof policySchema>;

const signedIntentSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    policyId: { type: ObjectId, ref: "Policy", required: true, unique: true },
    // This exact payload is signed; future policy edits create a new intent.
    payload: { type: String, required: true },
    keyId: { type: String, required: true },
    signature: { type: String, required: true },
    signedAt: { type: Date, required: true },
  },
  { collection: "signed_intents" },
);
export type SignedIntentRecord = InferSchemaType<typeof signedIntentSchema>;

const shopperWalletSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, unique: true },
    // Store only an encrypted PayPal vault token; encryption is added with PayPal integration.
    paypalVaultIdCiphertext: { type: String, required: true },
    connectedAt: { type: Date, required: true },
  },
  { collection: "shopper_wallets", timestamps: true },
);
export type ShopperWalletRecord = InferSchemaType<typeof shopperWalletSchema>;

const storeSchema = new Schema(
  {
    merchantUserId: { type: ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    paypalMerchantId: { type: String, required: true, trim: true },
  },
  { collection: "stores", timestamps: true },
);
export type StoreRecord = InferSchemaType<typeof storeSchema>;

const productSchema = new Schema(
  {
    storeId: { type: ObjectId, ref: "Store", required: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    priceCents: nonnegativeCents,
    active: { type: Boolean, required: true, default: true },
  },
  { collection: "products", timestamps: true },
);
productSchema.index({ storeId: 1, active: 1 });
export type ProductRecord = InferSchemaType<typeof productSchema>;

const cartItemSchema = new Schema(
  {
    productId: { type: ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    unitPriceCents: nonnegativeCents,
    quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  },
  { _id: false },
);
export type CartItem = InferSchemaType<typeof cartItemSchema>;

// The purchase request is the demo order; its embedded cart is a price snapshot.
const purchaseRequestSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    storeId: { type: ObjectId, ref: "Store", required: true },
    intentId: { type: ObjectId, ref: "SignedIntent", required: true },
    items: {
      type: [cartItemSchema],
      required: true,
      validate: { validator: (items: CartItem[]) => items.length > 0, message: "Cart is empty" },
    },
    totalCents: nonnegativeCents,
    currency: { type: String, required: true, enum: ["USD"], default: "USD" },
    reason: { type: String, required: true },
    status: { type: String, required: true, enum: purchaseRequestStatuses, default: "requested" },
    paypalState: { type: String, required: true, enum: paypalPaymentStates, default: "not_started" },
    paypalOrderId: { type: String },
    paypalAuthorizationId: { type: String },
    paypalCaptureId: { type: String },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { collection: "purchase_requests", timestamps: true },
);
purchaseRequestSchema.index({ userId: 1, createdAt: -1 });
purchaseRequestSchema.index({ paypalCaptureId: 1 }, { unique: true, sparse: true });
export type PurchaseRequestRecord = InferSchemaType<typeof purchaseRequestSchema>;

const purchaseCheckSchema = new Schema(
  {
    purchaseRequestId: { type: ObjectId, ref: "PurchaseRequest", required: true },
    kind: { type: String, required: true, enum: ["hard_rule", "ai_guard"] },
    status: { type: String, required: true, enum: policyCheckStatuses },
    reason: { type: String, required: true },
    checkedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: "purchase_checks" },
);
purchaseCheckSchema.index({ purchaseRequestId: 1, checkedAt: 1 });
export type PurchaseCheckRecord = InferSchemaType<typeof purchaseCheckSchema>;

const approvalSchema = new Schema(
  {
    purchaseRequestId: { type: ObjectId, ref: "PurchaseRequest", required: true, unique: true },
    userId: { type: ObjectId, ref: "User", required: true },
    status: { type: String, required: true, enum: approvalStatuses, default: "pending" },
    expiresAt: { type: Date, required: true },
    decidedAt: { type: Date },
  },
  { collection: "approvals", timestamps: true },
);
export type ApprovalRecord = InferSchemaType<typeof approvalSchema>;

const receiptSchema = new Schema(
  {
    purchaseRequestId: { type: ObjectId, ref: "PurchaseRequest", required: true, unique: true },
    intentId: { type: ObjectId, ref: "SignedIntent", required: true },
    // Canonical payload includes the cart, check results, and PayPal IDs.
    payload: { type: String, required: true },
    keyId: { type: String, required: true },
    signature: { type: String, required: true },
    signedAt: { type: Date, required: true },
  },
  { collection: "receipts" },
);
export type ReceiptRecord = InferSchemaType<typeof receiptSchema>;

const disputeSchema = new Schema(
  {
    receiptId: { type: ObjectId, ref: "Receipt", required: true },
    paypalDisputeId: { type: String, required: true, unique: true },
    status: { type: String, required: true, enum: disputeStatuses, default: "received" },
    reason: { type: String },
    evidenceNotes: { type: String },
    evidenceSubmittedAt: { type: Date },
    resolvedAt: { type: Date },
  },
  { collection: "disputes", timestamps: true },
);
export type DisputeRecord = InferSchemaType<typeof disputeSchema>;

export const Policy = model("Policy", policySchema);
export const SignedIntent = model("SignedIntent", signedIntentSchema);
export const ShopperWallet = model("ShopperWallet", shopperWalletSchema);
export const Store = model("Store", storeSchema);
export const Product = model("Product", productSchema);
export const PurchaseRequest = model("PurchaseRequest", purchaseRequestSchema);
export const PurchaseCheck = model("PurchaseCheck", purchaseCheckSchema);
export const Approval = model("Approval", approvalSchema);
export const Receipt = model("Receipt", receiptSchema);
export const Dispute = model("Dispute", disputeSchema);
