/** Agent page skeleton: header, avatar column and conversation panel. */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <div className="mb-6 flex items-center gap-3">
        <div className="size-9 rounded-full bg-surface-2" />
        <div className="size-12 rounded-full bg-surface-2" />
        <div className="h-7 w-40 rounded-lg bg-surface-2" />
      </div>
      <div className="grid gap-6 lg:h-[calc(100dvh-12.5rem)] lg:min-h-[560px] lg:grid-cols-[auto_1fr]">
        <div className="aspect-[9/16] h-[60dvh] rounded-[28px] bg-surface-2 lg:h-full" />
        <div className="hidden rounded-[28px] border border-line bg-surface lg:block" />
      </div>
    </div>
  );
}
