# mandate

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Hono, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **tRPC** - End-to-end type-safe APIs
- **Node.js** - Runtime environment
- **Mongoose** - TypeScript-first ORM
- **MongoDB** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

This project uses MongoDB with Mongoose.

1. Make sure you have MongoDB set up.
2. Update your `apps/server/.env` file with your MongoDB connection URI.

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
From `apps/native`, run the `ios` script for iOS or the `android` script for Android to build and launch the app. See [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/) for device setup.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@mandate/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

The server requires `INTENT_ED25519_PRIVATE_KEY`, a base64-encoded PKCS#8 DER Ed25519 private key. Generate one locally, then put the output in the ignored `apps/server/.env` (never commit it):

```bash
node -e 'const {generateKeyPairSync}=require("node:crypto"); console.log(generateKeyPairSync("ed25519").privateKey.export({format:"der",type:"pkcs8"}).toString("base64"))'
```

Keep the existing `INTENT_SIGNING_KEY` (at least 32 characters) unchanged for read-only verification of older HMAC-signed intents. New intents use only Ed25519. Keep both keys stable for this MVP; key rotation is not supported.

## Policy Compiler

The authenticated tRPC mutations `rules.preview` and `rules.confirm` accept policy text and an existing store ID. Preview returns validated rules, including the store's PayPal merchant ID and `recipientMustBe: "store"`; confirmation recomputes the preview, creates a versioned policy, and returns the signed `payload`, `keyId`, and `signature`. `rules.verifyIntent` checks a shopper's stored intent. The public `rules.verificationKeys` query returns the current Ed25519 JWK so a merchant can verify a new intent independently. These endpoints do not authorize payments.

The interpreter requires exactly three period-separated clauses, in any order (case-insensitive):

1. `<categories> up to $N a week` — also accepts `maximum` or `limit`/`limit of` instead of `up to`, and `per week` instead of `a week`.
2. `Ask me before anything over $N from a new category`.
3. `Never <categories>`.

`N` is a positive dollar amount with zero to two decimal places for the weekly cap and a nonnegative amount for the approval threshold. Category lists use commas, `and`, or `or`; supported names are grocery/groceries, books, clothing, electronics, gift card(s), and subscription(s). For example: “Groceries up to $80 a week. Ask me before anything over $30 from a new category. Never gift cards or subscriptions.” `Under $80`, extra clauses, unknown categories, and text over 2,000 characters are rejected rather than guessed.

New intents use a canonical version-2 JSON payload with `currency: "USD"` and a detached Ed25519 signature (base64url). Merchants verify the exact UTF-8 payload bytes using the JWK identified by `keyId`; this is not a JWS or full AP2 wire format. Existing `v1` HMAC records remain Mandate-verifiable only. Re-confirm the same policy to issue a new public-key-verifiable version.

Run compiler and signature tests with `pnpm --filter @mandate/api test` and `pnpm --filter server test`. For database-backed endpoint tests, start MongoDB and run `MANDATE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017 pnpm --filter server test:integration`. The test suite creates and removes its own randomly named database.

## Project Structure

```
mandate/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   ├── native/      # Mobile application (React Native, Expo)
│   └── server/      # Backend API (Hono, TRPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run dev:native`: Start the React Native/Expo development server
