#!/usr/bin/env node

import { run } from "../src/cli.js";

run(process.argv.slice(2)).catch((error) => {
  console.error(`velocity: ${error.message}`);
  process.exitCode = error.exitCode ?? 2;
});
