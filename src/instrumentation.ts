export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Testumgebung: zuerst die Sperre nach außen, dann alles andere.
    const { installTestGuard } = await import("./lib/testenv");
    installTestGuard();
    const { startPerfMonitor } = await import("./lib/perf");
    startPerfMonitor();
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
