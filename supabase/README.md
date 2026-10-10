# supabase

Supabase project as code: migrations, Row Level Security policies, Edge Functions (Deno) and seed data. The Supabase projects issue initializes this folder with `supabase init` and sets up the dev and prod projects.

Edge Functions import `@shoal/core`, which is why core must stay free of Node-only and browser-only APIs.
