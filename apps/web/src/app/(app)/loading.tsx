/** Shown at once while a panel page loads (the header stays). */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 rounded-lg bg-surface-2" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-surface-2" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-36 rounded-[22px] border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}
