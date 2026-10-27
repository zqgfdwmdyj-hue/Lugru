export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPerfMonitor } = await import("./lib/perf");
    startPerfMonitor();
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
