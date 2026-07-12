import { describe, expect, it } from "bun:test";
import { parseArgs } from "@oh-my-pi/pi-coding-agent/cli/args";
import Index from "@oh-my-pi/pi-coding-agent/commands/launch";
import { LITE_CORE_SETTING_PATHS } from "@oh-my-pi/pi-coding-agent/lite/lite-settings-filter";

describe("lite CLI surface", () => {
	it("shows only the core launch flags in generated help metadata", () => {
		expect(Object.keys(Index.flags ?? {})).toEqual(["model", "mode", "print", "no-pty"]);
	});

	it("keeps legacy launch flags parseable after hiding them from help", () => {
		const parsed = parseArgs(["--continue", "--approval-mode", "write", "--model", "opus", "--print", "hello"]);

		expect(parsed.continue).toBe(true);
		expect(parsed.approvalMode).toBe("write");
		expect(parsed.model).toBe("opus");
		expect(parsed.print).toBe(true);
		expect(parsed.messages).toEqual(["hello"]);
	});

	it("ships lite defaults for every core settings row", async () => {
		const defaults = (await Bun.file(new URL("../src/config/lite-defaults.json", import.meta.url)).json()) as Record<
			string,
			unknown
		>;

		expect(defaults.renderStyle).toBe("claude");
		for (const path of LITE_CORE_SETTING_PATHS) {
			expect(Object.hasOwn(defaults, path)).toBe(true);
		}
	});
});
