import { readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const probePath = fileURLToPath(new URL("./runtime-probe.cjs", import.meta.url));

function quoteNodeOption(value) {
  return value.includes(" ") ? `\"${value.replaceAll('"', '\\"')}\"` : value;
}

export async function profileNodeProcess(command, args = [], options = {}) {
  const outputPath = path.join(tmpdir(), `velocity-profile-${randomUUID()}.json`);
  const requireOption = `--require ${quoteNodeOption(probePath)}`;
  const existingOptions = options.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? "";
  const env = {
    ...process.env,
    ...options.env,
    NODE_OPTIONS: `${existingOptions} ${requireOption}`.trim(),
    VELOCITY_PROFILE_OUTPUT: outputPath
  };

  const exit = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: options.stdio ?? "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  let result;
  try {
    result = JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    throw new Error("The target did not produce Node.js profile data. Run a Node.js command directly, for example: velocity profile -- node server.js");
  } finally {
    await rm(outputPath, { force: true });
  }

  return {
    command: [command, ...args],
    exit,
    ...result
  };
}
