export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="mb-10">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
          Overview
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Welcome to Nexa
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Your internal operations workspace is ready for the next step.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex size-11 items-center justify-center rounded-xl bg-cyan-50 text-lg font-semibold text-cyan-700">
          N
        </div>
        <h2 className="mt-6 text-xl font-semibold text-slate-950">
          Your workspace is set up
        </h2>
        <p className="mt-2 max-w-xl leading-7 text-slate-600">
          Customers, services, time, and billing tools will come together here
          as Nexa grows.
        </p>
      </section>
    </div>
  );
}
