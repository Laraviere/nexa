import { AppNavigation } from "@/components/app/navigation";
import { PageContainer } from "@/components/ui/page-container";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="nexa-workspace nexa-graphite min-h-dvh bg-workspace text-ink lg:flex lg:items-start">
    <a href="#main-content" className="fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-surface px-4 py-3 text-sm font-semibold text-ink focus:translate-y-0">Skip to content</a>
    <AppNavigation />
    <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
      <PageContainer gutters>{children}</PageContainer>
    </main>
  </div>;
}
