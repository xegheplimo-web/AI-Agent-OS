export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="mx-auto mt-2 h-10 w-72 shimmer rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_648px]">
        <div className="h-[648px] shimmer rounded-2xl" />
        <div className="grid content-start gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-72 shimmer rounded-2xl" />
          ))}
        </div>
      </div>
      <div className="h-32 shimmer rounded-2xl" />
    </div>
  );
}
