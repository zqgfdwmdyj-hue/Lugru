export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Testumgebung: zuerst die Sperre nach außen, dann alles andere.
    const { installTestGuard } = await import("./lib/testenv");
    installTestGuard();
    const { startPerfMonitor } = await import("./lib/perf");
    startPerfMonitor();
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    // B21: Discord-Call-Kanal live lesen (eigener Schalter, damit es auch ohne Zeitplan – z. B. in den Prüfungen – läuft).
    if (process.env.DISCORD_LIVE !== "0" && (process.env.ENABLE_SCHEDULER !== "0" || process.env.DISCORD_LIVE === "1")) {
      const { startDiscordLive } = await import("./lib/discord/gateway");
      startDiscordLive();
    }
  }
}
