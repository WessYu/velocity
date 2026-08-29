const fs = require("node:fs");
const os = require("node:os");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");

const outputPrefix = process.env.VELOCITY_PROFILE_PREFIX;
const outputPath = outputPrefix ? `${outputPrefix}-${process.pid}.json` : null;

if (outputPath) {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();
  const startedElu = performance.eventLoopUtilization();
  let peakRss = process.memoryUsage().rss;

  histogram.enable();
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 25);
  sampler.unref();

  let finalized = false;
  function finalize(terminationSignal = null) {
    if (finalized) return;
    finalized = true;
    clearInterval(sampler);
    histogram.disable();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(startedCpu);
    const elu = performance.eventLoopUtilization(startedElu);
    const nanosecondsToMs = (value) => Number.isFinite(value) ? value / 1e6 : 0;

    const result = {
      schemaVersion: 1,
      pid: process.pid,
      nodeVersion: process.version,
      durationMs: performance.now() - startedAt,
      terminationSignal,
      cpu: {
        userMs: cpu.user / 1e3,
        systemMs: cpu.system / 1e3
      },
      memory: {
        rssBytes: memory.rss,
        peakRssBytes: peakRss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external
      },
      eventLoop: {
        utilization: elu.utilization,
        activeMs: elu.active,
        idleMs: elu.idle,
        delayMeanMs: nanosecondsToMs(histogram.mean),
        delayP95Ms: nanosecondsToMs(histogram.percentile(95)),
        delayP99Ms: nanosecondsToMs(histogram.percentile(99)),
        delayMaxMs: nanosecondsToMs(histogram.max)
      }
    };

    try {
      // velocity-ignore-next-line node/no-blocking-fs -- exit hooks cannot await
      fs.writeFileSync(outputPath, JSON.stringify(result));
    } catch {
      // Profiling must never change the target process exit behavior.
    }
  }

  process.once("exit", () => finalize());
  for (const signal of ["SIGINT", "SIGTERM"]) {
    if (process.listenerCount(signal) > 0) continue;
    const preserveSignalExit = () => {
      finalize(signal);
      const signalNumber = os.constants.signals[signal];
      process.exit(128 + signalNumber);
    };
    process.once(signal, preserveSignalExit);
  }
}
