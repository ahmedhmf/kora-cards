const originalMemoryUsage = process.memoryUsage;
process.memoryUsage = function safeMemoryUsage() {
  try { return originalMemoryUsage(); }
  catch { return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }; }
};
process.memoryUsage.rss = function safeRss() {
  try { return originalMemoryUsage.rss(); }
  catch { return 0; }
};
