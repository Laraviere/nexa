# Invoice PDF generation

## Architecture

`GET /invoices/[id]/pdf` is a dynamic Next.js Node route. It validates the caller with the cookie-based Supabase client, reads through RLS, and returns `application/pdf` with an inline `Nexa-Invoice-<number>.pdf` filename. Responses (including errors) use `private, no-store` and vary by Cookie. It uses no service role, public storage, background work, or invoice mutations.

The renderer is `@react-pdf/renderer`: real selectable text and vector layout, without a browser binary, browser automation, external rendering service, or runtime font downloads. HTML/browser printing would couple the invoice document to page CSS; a headless browser would add deployment weight. React PDF provides the dedicated paged layout used here. The route builds successfully with Nexa's Next.js 16 webpack production build. A hosted deployment smoke test remains necessary; this milestone only validates locally.

Sources:
- https://react-pdf.org/docs/v4/node
- https://react-pdf.org/docs/v4/advanced
- https://react-pdf.org/docs/v4/fonts

## Data and consistency

`src/lib/invoices/pdf/data.ts` loads persisted invoice snapshots, current ordered items (`superseded_at IS NULL`), and authoritative `invoice_totals`. It never reads current customer/agreement values or composer state and never multiplies quantities/rates or sums totals. Voided invoices retain their current historical composition and figures.

It pages through all invoice items and checks the parent `updated_at` after reading. Existing invoice/child triggers touch that revision. If a concurrent edit commits during the reads, it retries, then returns 409 if the invoice keeps changing. No data is cached across requests. A PDF represents the persisted version read during that request; a later request reflects subsequent edits.

Authentication failures return 401; missing/RLS-hidden invoices return 404; explicit permission errors return 403. Database/render failures return a generic 500, with no raw database error or credentials. The endpoint does not broaden the app's existing authenticated RLS policies.

## Document and interaction

US Letter, 42-point side margins, Helvetica, restrained cyan branding, clear customer snapshot address/contact, issue/due dates, ordered line items and a strong Total. Tax is always shown, including zero, matching invoice detail. Quantities drop trailing zeros and use singular/plural units; flat-fee quantities above one remain explicit. Amounts use the existing USD formatter with two decimals. Notes/terms preserve line breaks and disappear when absent.

Draft says `DRAFT — For review`; Ready and Sent retain their friendly labels; Void says `VOID — Not payable`. PDF generation never changes status or implies that an email was sent. View PDF sits beside Edit Invoice and opens a new browser tab for viewing, downloading or printing; the existing workflow action remains below the invoice card.

Long invoices have repeated invoice identification, continuation column labels, and page counts. Ordinary item rows stay together. Very long descriptions are split into bounded presentation fragments with amounts shown only on the first fragment; no text is discarded. Totals stay together. Notes/terms flow across pages. Fixed footers have explicit height, and the document avoids inherited numeric line height because of React PDF's pagination issue (https://github.com/diegomura/react-pdf/issues/3416).

Business identity is isolated in `src/lib/invoices/pdf/business.ts`. Only the known name Nexa is configured. No fictional contact/address details are shipped. Later Settings can supply this information. Helvetica supports Western text; broader scripts/emoji require separately bundled fonts and coverage testing. The PDFs contain selectable text but are not claimed to meet PDF/UA accessibility certification.

## Future delivery

PDFs are generated on demand, not stored. Existing sent-status invoices also regenerate from their current persisted content. They are not an immutable record of what a recipient received. Future Send Invoice may reuse the data loader and renderer, store the exact delivered bytes plus sender identity/version, send them, and only then record delivery and transition status. None of that is implemented here.

## Validation and review

`tests/invoice-pdf.test.mjs` parses actual PDF text and page bounds using the test-only `pdfjs-dist`, covering statuses, persisted figures (deliberately different from quantity × rate), friendly quantities, optional prose, long descriptions/notes, repeated headings/page counts, permissions, safe errors and read-revision retries.

`tests/invoice-pdf.local.test.mjs` builds and runs Next against local Docker Supabase, creates synthetic invoices, tests real authenticated HTTP requests for all statuses, snapshot isolation from changed customer details, filename/no-cache responses, 75 ordered items over multiple pages, and regeneration after an atomic Ready invoice edit. It keeps only void/archived synthetic database history afterward and removes the test login. No hosted operations or policy changes occur.

Run:

```sh
node --test tests/invoice-pdf.test.mjs
node --test tests/invoice-pdf.local.test.mjs
```

The local integration test writes synthetic review samples to:

- `/tmp/nexa-invoice-pdf-samples/ready.pdf`
- `/tmp/nexa-invoice-pdf-samples/multiple-pages.pdf`
- `/tmp/nexa-invoice-pdf-samples/void.pdf`

The normal Ready, Void and multi-page continuation/final-page samples were rendered to PNG with an isolated temporary PyMuPDF tool and visually inspected. No Python dependency is needed for application runtime or automated tests.
