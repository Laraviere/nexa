# Graphite workspace and navigation audit

Scope: authenticated UI palette and safe read concurrency. No database, RPC,
authorization, financial calculation, mutation/retry, or PDF changes.

## Evidence and limits

Code was inspected across the shell, proxy, authenticated layout, route readers,
Supabase clients, links/forms, and installed Next.js 16.3.4 navigation documentation.
No browser is connected. No hosted queries, browser performance trace, Vercel
request timings, or production query timings were collected. We cannot identify
the slowest hosted query or quantify real development-versus-production latency.

A repeatable database-independent test injects 40ms per query, preloads the module
before timing, and records concurrency. One-page fixtures produced:

| Reader | Before | After | Queries | Peak concurrency |
| --- | ---: | ---: | ---: | --- |
| invoiceDetail | 123ms | 82ms | 3, unchanged | 1 → 2 |
| invoicePayments | 123ms | 82ms | 3, unchanged | 1 → 2 |

These demonstrate avoidable application waterfalls, not Supabase performance.
Timings vary with test scheduling; concurrency assertions are deterministic.

## Navigation and request behavior

- Sidebar, mobile navigation, primary record links and ButtonLink use Next Link.
  Normal page-to-page navigation requests RSC content, not a full document reload.
- Native GET forms (search/filter submission and payment selection) perform
  document navigation. They are not the cause of every sidebar transition.
- Report error retries deliberately use plain anchors to force a fresh request.
  Changing them to a same-URL Link could fail to retry; they were retained.
- PDF anchors intentionally open documents in a new tab; the skip link is an
  in-document anchor. Neither is an accidental page-navigation implementation.
- Router refresh after mutations and login is intentional; it refreshes RSC data,
  not an ordinary full browser document reload. Retry/idempotency flows remain.
- Proxy runs token validation/session refresh for matching requests, including
  route/prefetch requests. The authenticated layout also validates claims.
  Shared layouts are reused during client navigation; do not assume this layout
  is necessarily rerun for every click. Readers validate independently.
- Several helpers create separate clients and repeat getClaims. For example,
  invoicePayments validates through customerClient, reads claims for the owner,
  and paymentSettings validates via another client. These are repeated calls,
  but not proof of repeated network round trips: JWT verification/JWKS caching
  and refresh behavior matter. No authentication checks were removed.
- Cookie access makes authenticated data rendering request-dependent. No shared
  data cache or new cross-user caching was introduced.
- Link uses default prefetch behavior. Dynamic routes without loading.tsx are
  not fully prefetched by default. Customers and Time have loading boundaries;
  Dashboard, Quotes, Invoices, Payments and Settings lack route loading files.
  Their clicks may appear to wait for data. No fake progress overlay or aggressive
  full financial-page prefetch was introduced. Loading boundaries can improve
  feedback but cannot reduce database latency.
- Next's automatic Link prefetch is production behavior; development additionally
  has on-demand compilation and tooling overhead. Compare warmed `next start`
  against warmed `next dev` before attributing a production issue to development.

## Route read map

All data reads below follow authentication and existing RLS.

| Route / workflow | Reads and dependencies |
| --- | --- |
| Dashboard | Nine initial branches in parallel: open balances, monthly payments, monthly time, Ready count, timer, recent payments, recent time, current agreements, drafts. Bounded scans use 200-row pages (2,000-row cap); invoice metadata is subsequently batched; missing draft balances are read; up to 25 usage RPCs run in groups of five. Highest visible fan-out, not a proven slow query. |
| Customers list | One ordered, filtered, counted 25-row customer query. |
| Customer detail | Customer → paginated agreement history → current agreement's usage RPC when applicable. Multiple helper auth checks; usage depends on agreement resolution. |
| Customer create/edit | Create is primarily a form; edit reads the customer. |
| Quotes list | One ordered, searched, counted 25-row quote query. |
| Quote detail | Quote → converted invoice number if related. Relationship read depends on the quote. |
| Quote create/edit | Customer-option pages; edit first reads the quote. Further parallelization is possible, but edit eligibility and errors should be retained. |
| Invoice report | Customer-option pages and get_invoice_report RPC already run in parallel. Options are reloaded on each report request. |
| Invoice detail | Invoice existence check → line pages and totals now overlap. Then payments and source-quote lookup now overlap. Payment summary validation remains first; payment history and settings then overlap. |
| Invoice composer | Customer-option pages, then current-agreement pages; editing additionally reads invoice detail first. Client preview RPCs depend on selected customer/dates. Options and agreements could be independent, but were left outside the measured change. |
| Payments report | Customer-option pages and get_payment_report RPC already run in parallel. |
| Record Payment | Customer options → eligible invoice pages and their balance batches → selected invoice → payment summary/history/settings. Selection must preserve uncertain-payment recovery even after eligibility changes. |
| Time | Entry list, running timer and paginated customer options already run in parallel. Helpers authenticate independently. |
| Settings → Payments | One singleton payment_settings read, passed to both forms. |

## Optimizations and boundaries

Implemented only measured, independent read overlap:

1. Invoice lines and totals after invoice authorization/existence validation.
2. Payment history and settings after payment-summary validation.
3. Payment information and source quote after invoice detail resolves.

Pagination, row counts, ordering, error validation, ownership and financial values
are retained. Parallel reads do not add transactional snapshot consistency;
these screens already used multiple independent reads. PDF revision checks were
not changed. No customer-option caching, auth deduplication, dashboard fan-out
expansion, RPC changes, or retry-link replacement was attempted.

## Palette

Authenticated shell only: workspace #2b2f36; surface #363c45; raised surface
#414955; subtle surface #303740. Primary text #eef2f6; secondary #c3cbd5;
muted #b6c0cc; cyan link/focus #67d4ed. Native controls use dark color-scheme.
Status colors have paired dark semantic surfaces and readable text. Primary
buttons keep their existing dark-cyan fill and white text. The navy sidebar and
Login retain their design. Invoice/quote web documents use the new surface;
PDFs are rendered independently and remain unchanged.

Automated palette tests check 4.5:1 text contrast across workspace/surface/raised
backgrounds and semantic pairs, plus 3:1 input-boundary contrast. This does not
replace inspecting every rendered combination in a browser.

## Manual verification

At 1440, 1024, 768, 390 and 320px, inspect financial values, long names, native date
controls, selected radios, switches, badges, hover/focus, menus and confirmations.
Record warmed production navigation timings with browser Network Preserve log:
distinguish Document from RSC requests; compare TTFB and server timings across
routes. Correlate slow requests with Vercel and Supabase query timings before
changing database indexes, query limits, caching or authentication.
