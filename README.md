# Nexa

Nexa is the internal operations application for an IT consulting business.
This repository currently contains the Next.js and Supabase technical foundation only. Business features, database tables, and migrations are intentionally not included yet.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and add the two values from the Nexa Supabase project:

   ```bash
   cp .env.example .env.local
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

The Supabase CLI configuration lives in `supabase/config.toml`. It is local configuration only; no cloud project has been linked and no migrations have been created. The production build uses Next.js's supported webpack builder for consistent builds in restricted environments.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

## Supabase environment variables

Set these in `.env.local` using the Supabase Dashboard for the existing Nexa project under Project Settings → API:

- `NEXT_PUBLIC_SUPABASE_URL`: the project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the publishable client key

The publishable key is safe for browser use when paired with appropriate database Row Level Security. No service-role key belongs in this application’s environment or client bundle.
