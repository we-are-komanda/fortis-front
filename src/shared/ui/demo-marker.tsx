export function DemoMarker() {
  return <div role="status" className="pointer-events-none fixed bottom-3 left-3 z-[100] max-w-[calc(100%-1.5rem)] rounded-lg border border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 shadow-sm">
    <strong>Демонстрационные данные</strong><span className="hidden sm:inline"> — синтетические примеры, не ваш рабочий проект.</span>
  </div>;
}
