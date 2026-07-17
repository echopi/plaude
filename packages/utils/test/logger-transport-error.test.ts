import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const loggerModuleUrl = pathToFileURL(join(import.meta.dir, "../src/logger.ts")).href;
const dailyRotateFileModuleUrl = import.meta.resolve("winston-daily-rotate-file");

async function runLoggerProbe(): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
	const root = await mkdtemp(join(tmpdir(), "omp-logger-transport-error-"));
	const probePath = join(root, "probe.ts");
	try {
		await Bun.write(
			probePath,
			`
				import DailyRotateFile from "${dailyRotateFileModuleUrl}";
				import * as logger from "${loggerModuleUrl}";

				DailyRotateFile.prototype.log = function (_info, callback) {
					const error = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
					queueMicrotask(() => this.emit("error", error));
					callback();
				};
				process.once("beforeExit", () => {
					console.log("survived logger transport failure");
				});
				logger.setTransports({ file: "${root}", console: false });
				logger.error("trigger failing file transport");
			`,
		);
		const proc = Bun.spawn([process.execPath, probePath], {
			cwd: process.cwd(),
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { exitCode, stdout, stderr };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("logger transport failures", () => {
	it("reports a failed file transport without terminating the process", async () => {
		const result = await runLoggerProbe();

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("survived logger transport failure");
		expect(result.stderr).toContain("Log transport failure");
	});
});
