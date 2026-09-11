import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDFKit loads standard fonts through dynamic package imports. Explicitly
  // include them in both PDF functions; local node_modules masks missing traces.
  outputFileTracingIncludes: {
    "/quotes/*/pdf": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
    "/invoices/*/pdf": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
  },
};

export default nextConfig;
