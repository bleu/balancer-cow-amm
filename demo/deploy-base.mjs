// Backwards-compatible entry point. Prefer pnpm demo:deploy:base.
process.argv.push("--chain", "8453");
await import("./deploy.mjs");
