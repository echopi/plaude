import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Rule } from "@oh-my-pi/pi-coding-agent/capability/rule";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { CustomMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/custom-message";
import { HookMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/hook-message";
import { SkillMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/skill-message";
import { TodoReminderComponent } from "@oh-my-pi/pi-coding-agent/modes/components/todo-reminder";
import { TtsrNotificationComponent } from "@oh-my-pi/pi-coding-agent/modes/components/ttsr-notification";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { CustomMessage, HookMessage, SkillPromptDetails } from "@oh-my-pi/pi-coding-agent/session/messages";

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme(false);
});

afterEach(() => {
	settings.set("renderStyle", "omp");
});

function renderClaude(component: { render(width: number): readonly string[] }): { raw: string; visible: string } {
	settings.set("renderStyle", "claude");
	const raw = component.render(120).join("\n");
	return { raw, visible: Bun.stripANSI(raw) };
}

function renderClaudeComponent(create: () => { render(width: number): readonly string[] }): {
	raw: string;
	visible: string;
} {
	settings.set("renderStyle", "claude");
	return renderClaude(create());
}

function rule(name: string, description: string): Rule {
	return {
		name,
		path: `/tmp/${name}.md`,
		content: description,
		description,
		_source: {
			provider: "test",
			providerName: "Test",
			path: `/tmp/${name}.md`,
			level: "project",
		},
	};
}

describe("Claude-style notification rendering", () => {
	it("renders todo reminders as a lightweight transcript warning", () => {
		const { raw, visible } = renderClaude(
			new TodoReminderComponent(
				[
					{ content: "Install build on device", status: "pending" },
					{ content: "Run WebAbility smoke path", status: "pending" },
				],
				1,
				3,
			),
		);

		expect(raw).not.toContain("\x1b[7m");
		expect(visible).toContain("  ⚠ 2 incomplete todos · reminder 1/3");
		expect(visible).toContain("    ☐ Install build on device");
		expect(visible).toContain("    ☐ Run WebAbility smoke path");
	});

	it("renders TTSR notifications without the legacy full-width warning card", () => {
		const { raw, visible } = renderClaude(new TtsrNotificationComponent([rule("no-console", "Avoid console.log")]));

		expect(raw).not.toContain("\x1b[7m");
		expect(visible).toContain("  ⚠ Injecting rule: no-console");
		expect(visible).toContain("  Avoid console.log");
	});

	it("renders default custom messages without transcript cards", () => {
		const message: CustomMessage = {
			role: "custom",
			customType: "status",
			content: "created review",
			display: true,
			timestamp: Date.now(),
		};
		const { raw, visible } = renderClaudeComponent(() => new CustomMessageComponent(message));

		expect(raw).not.toContain("\x1b[48");
		expect(visible).not.toContain("╭");
		expect(visible.split("\n").some(line => line.startsWith("  ") && line.includes("status"))).toBe(true);
		expect(visible).toContain("  created review");
	});

	it("renders default hook messages without transcript cards", () => {
		const message: HookMessage = {
			role: "hookMessage",
			customType: "hook-warning",
			content: "check failed",
			display: true,
			timestamp: Date.now(),
		};
		const { raw, visible } = renderClaudeComponent(() => new HookMessageComponent(message));

		expect(raw).not.toContain("\x1b[48");
		expect(visible).not.toContain("╭");
		expect(visible).toContain("  hook-warning");
		expect(visible).toContain("  check failed");
	});

	it("renders skill messages without transcript cards", () => {
		const message: CustomMessage<SkillPromptDetails> = {
			role: "custom",
			customType: "skill-prompt",
			content: "Use the skill.",
			display: true,
			details: {
				name: "devix",
				path: "/tmp/devix/SKILL.md",
				lineCount: 10,
			},
			timestamp: Date.now(),
		};
		const { raw, visible } = renderClaudeComponent(() => new SkillMessageComponent(message));

		expect(raw).not.toContain("\x1b[48");
		expect(visible).not.toContain("╭");
		expect(visible.split("\n").some(line => line.startsWith("  ") && line.includes("skill devix"))).toBe(true);
		expect(visible).toContain("/tmp/devix/SKILL.md");
	});
});
