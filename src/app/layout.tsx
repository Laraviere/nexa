import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexa",
  description: "Internal operations for your IT consulting business.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
