import { spawn } from "node:child_process";

const commands = [
  spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit", env: process.env }),
  spawn(process.platform === "win32" ? "node_modules/.bin/vinext.cmd" : "node_modules/.bin/vinext", ["start"], {
    stdio: "inherit",
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of commands) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 200).unref();
}
for (const child of commands) child.on("exit", (code, signal) => {
  if (!stopping && code && signal !== "SIGTERM") stop(code);
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
