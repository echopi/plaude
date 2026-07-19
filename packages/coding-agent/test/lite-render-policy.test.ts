import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tool-execution";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { Text, type TUI } from "@oh-my-pi/pi-tui";

function strip(component: ToolExecutionComponent): string {
	return Bun.stripANSI(component.render(160).join("\n"));
}

function makeUi(): TUI {
	return { requestRender() {}, requestComponentRender() {} } as unknown as TUI;
}

function result(text: string, details?: unknown) {
	return { content: [{ type: "text", text }], details };
}

function customTool(): AgentTool {
	return {
		name: "custom_render",
		label: "Custom",
		renderCall(): Text {
			return new Text("full:call", 0, 0);
		},
		renderResult(): Text {
			return new Text("full:result", 0, 0);
		},
	} as unknown as AgentTool;
}

describe("lite render policy", () => {
	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { renderStyle: "claude" } });
		await initTheme();
	});

	afterEach(() => {
		resetSettingsForTest();
	});

	it("renders completed tools as a collapsed one-line summary by default", () => {
		const component = new ToolExecutionComponent(
			"bash",
			{ command: "printf hello" },
			{},
			undefined,
			makeUi(),
			process.cwd(),
		);

		component.updateResult(result("hello\nwarning: check me", { exitCode: 0 }), false);

		const rendered = strip(component);
		expect(rendered).toContain("bash(printf hello) -> exit 0: warning: check me");
		expect(rendered).not.toContain("Wall:");
	});

	it("keeps installed Plaude wrappers on Claude defaults during env migration", async () => {
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				'import { Settings } from "./src/config/settings"; const s = await Settings.init({ inMemory: true }); console.log(s.get("renderStyle") + ":" + s.get("statusLine.preset"));',
			],
			{
				cwd: new URL("../", import.meta.url).pathname,
				env: { ...process.env, PLAUDE: undefined, PLAUDE_STATUSLINE_STYLE: "claude" },
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		expect(await new Response(child.stdout).text()).toBe("claude:lite\n");
		expect(await child.exited).toBe(0);
	});

	it("keeps Claude-style collapsed tool summaries away from the left terminal edge", () => {
		settings.set("renderStyle", "claude");
		const component = new ToolExecutionComponent(
			"bash",
			{ command: "printf hello" },
			{},
			undefined,
			makeUi(),
			process.cwd(),
		);

		component.updateResult(result(""), false);

		const rendered = strip(component);
		expect(
			rendered.split("\n").some(line => line.startsWith("  ") && line.includes("bash(printf hello) -> ok")),
		).toBe(true);
	});

	it("keeps Claude-style collapsed task summaries aligned with tool summaries", () => {
		settings.set("renderStyle", "claude");
		const component = new ToolExecutionComponent("task", { agent: "codex" }, {}, undefined, makeUi(), process.cwd());

		component.updateResult(result("done"), false);

		const rendered = strip(component);
		expect(rendered.split("\n").some(line => line.startsWith("  ") && line.includes("codex - completed: done"))).toBe(
			true,
		);
	});

	it("keeps Claude-style compact edit diff rows aligned with the tool summary", () => {
		settings.set("renderStyle", "claude");
		const component = new ToolExecutionComponent(
			"edit",
			{ file_path: "src/app.ts" },
			{},
			undefined,
			makeUi(),
			process.cwd(),
		);

		component.updateResult(
			result("Edited src/app.ts", {
				path: "src/app.ts",
				diff: ["@@ -1,2 +1,2 @@", "-const oldValue = true;", "+const newValue = true;"].join("\n"),
			}),
			false,
		);

		const lines = strip(component).split("\n");
		expect(lines.some(line => line.startsWith("  ") && line.includes("edit(file_path:src/app.ts) -> ok"))).toBe(true);
		expect(lines.some(line => line.startsWith("  @@ -1,2 +1,2 @@"))).toBe(true);
		expect(lines.some(line => line.startsWith("  -const oldValue = true;"))).toBe(true);
		expect(lines.some(line => line.startsWith("  +const newValue = true;"))).toBe(true);
	});

	it("uses the original renderer when tool output is expanded", () => {
		const component = new ToolExecutionComponent("custom_render", {}, {}, customTool(), makeUi(), process.cwd());

		component.updateResult(result("done"), false);
		expect(strip(component)).toContain("custom_render -> ok");
		expect(strip(component)).not.toContain("full:result");

		component.setExpanded(true);
		expect(strip(component)).toContain("full:result");
	});

	it("uses the original renderer when renderStyle is omp", async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { renderStyle: "omp" } });
		await initTheme();

		const component = new ToolExecutionComponent("custom_render", {}, {}, customTool(), makeUi(), process.cwd());

		component.updateResult(result("done"), false);

		expect(strip(component)).toContain("full:result");
		expect(strip(component)).not.toContain("custom_render -> ok");
	});

	it("renders short edit diffs as compact hunks in lite mode", () => {
		const component = new ToolExecutionComponent(
			"edit",
			{ file_path: "src/app.ts" },
			{},
			undefined,
			makeUi(),
			process.cwd(),
		);

		component.updateResult(
			result("Edited src/app.ts (1 hunk, +2 -1)", {
				path: "src/app.ts",
				diff: [
					"@@ -10,8 +10,9 @@",
					" const before1 = true;",
					" const before2 = true;",
					" const before3 = true;",
					" const before4 = true;",
					"-const value = oldValue;",
					"+const value = newValue;",
					"+const enabled = true;",
					" const after1 = true;",
					" const after2 = true;",
					" const after3 = true;",
					" const after4 = true;",
				].join("\n"),
			}),
			false,
		);

		const rendered = strip(component);
		expect(rendered).toContain("edit(file_path:src/app.ts) -> ok");
		expect(rendered).toContain("@@ -10,8 +10,9 @@");
		expect(rendered).toContain("-const value = oldValue;");
		expect(rendered).toContain("+const value = newValue;");
		expect(rendered).not.toContain("const before1 = true;");
		expect(rendered).not.toContain("const after4 = true;");
	});

	it("folds long edit diffs in lite mode", () => {
		const component = new ToolExecutionComponent(
			"edit",
			{ file_path: "src/app.ts" },
			{},
			undefined,
			makeUi(),
			process.cwd(),
		);
		const diff = [
			"@@ -1,24 +1,24 @@",
			...Array.from({ length: 24 }, (_, index) => `-const old${index} = ${index};`),
			...Array.from({ length: 24 }, (_, index) => `+const next${index} = ${index};`),
		].join("\n");

		component.updateResult(result("Edited src/app.ts (1 hunk, +24 -24)", { path: "src/app.ts", diff }), false);

		const rendered = strip(component);
		expect(rendered).toContain("edit(file_path:src/app.ts) -> ok");
		expect(rendered).toContain("diff 49 lines folded; ctrl+o for full output");
		expect(rendered).not.toContain("-const old0 = 0;");
		expect(rendered).not.toContain("+const next23 = 23;");
	});
});
