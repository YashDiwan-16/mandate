# Repository Guidelines

## Project Structure & Module Organization

This pnpm workspace is managed by Turborepo. Application entry points live under `apps/`:

- `apps/web/`: Next.js web application; routes and UI are under `src/app/` and `src/components/`.
- `apps/native/`: Expo/React Native application; screens use Expo Router under `app/`.
- `apps/server/`: Hono/tRPC server; startup code is in `src/index.ts`.

Reusable code lives under `packages/`: `api` for tRPC routers, `auth` for Better Auth, `db` for Mongoose models, `ui` for shared components, and `config` for TypeScript settings. Each app/package owns its `.env.schema`; do not edit generated accessors manually.

## Build, Test, and Development Commands

Run from the repository root:

```bash
pnpm install                 # Install workspace dependencies
pnpm run dev                 # Start all apps through Turborepo
pnpm run dev:web             # Start Next.js on port 3001
pnpm run dev:server          # Start the API server
pnpm run dev:native          # Start Expo with a cleared cache
pnpm run build               # Build all configured apps/packages
pnpm run check-types         # Type-check the entire workspace
pnpm run env:generate        # Regenerate Varlock environment accessors
```

For database work, configure MongoDB and the relevant ignored `.env` file first. Run standalone tools from their owning app directory so Varlock resolves the correct schema.

## Coding Style & Naming Conventions

Use TypeScript and the surrounding code’s two-space indentation, semicolons, and single quotes. Use `PascalCase` for React components, `camelCase` for functions and variables, and kebab-case for route/component filenames where established. Prefer `@mandate/*` imports; put reusable UI primitives in `packages/ui`.

## Testing Guidelines

Focused Node tests use `tsx --test`. Run `pnpm --filter @mandate/api test` and `pnpm --filter server test`, then `pnpm run check-types`. Rule endpoint integration tests need a local MongoDB service: set `MANDATE_TEST_MONGODB_URI` and run `pnpm --filter server test:integration`. No coverage threshold is configured.

## Commit & Pull Request Guidelines

The history contains only an `initial commit`, so no convention is established. Use short, imperative subjects such as `Add session validation`. Pull requests should explain impact, identify affected apps/packages, list validation commands, and include screenshots for UI changes. Call out environment-schema or database changes.

## Security & Configuration Tips

Commit `.env.schema` files, not secrets. Keep local credentials in ignored environment files or deployment configuration. Review changes to auth, database models, and generated environment accessors carefully before sharing them.
