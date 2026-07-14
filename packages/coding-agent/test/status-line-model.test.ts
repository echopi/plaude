import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { Effort } from "@oh-my-pi/pi-ai";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme();
});

afterAll(() => {
	resetSettingsForTest();
});

afterEach(() => {
	settings.set("renderStyle", "omp");
});

function createModelContext(advisorActive: boolean): SegmentContext {
	return {
		session: {
			state: { model: { id: "test-model", name: "Test Model" } },
			isFastModeActive: () => false,
			isAutoThinking: false,
			autoResolvedThinkingLevel: () => undefined,
			isAdvisorActive: () => advisorActive,
		} as unknown as SegmentContext["session"],
		width: 120,
		compactThinkingLevel: false,
		options: {},
		planMode: null,
		loopMode: null,
		prewalk: null,
		goalMode: null,
		vibeMode: null,
		collab: null,
		usageStats: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			orchestrationInput: 0,
			orchestrationOutput: 0,
			orchestrationCacheRead: 0,
			premiumRequests: 0,
			cost: 0,
			tokensPerSecond: null,
		},
		contextPercent: 0,
		contextTokens: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		subagentCount: 0,
		activeMs: 0,
		activeRepo: null,
		worktree: null,
		git: { branch: null, status: null, pr: null },
		usage: null,
	};
}

describe("status line model segment advisor badge", () => {
	it("renders only the model id in Claude style", () => {
		settings.set("renderStyle", "claude");
		const ctx = createModelContext(true);
		ctx.session.state.model = {
			...ctx.session.state.model!,
			id: "claude-sonnet-4-5",
			name: "Claude Sonnet 4.5",
			thinking: { mode: "effort", efforts: [Effort.High] },
		};
		ctx.session.state.thinkingLevel = ThinkingLevel.High;

		const rendered = renderSegment("model", ctx);

		expect(Bun.stripANSI(rendered.content)).toBe("claude-sonnet-4-5");
		settings.set("renderStyle", "omp");
	});

	it("appends a success-colored ++ badge when the advisor is active", () => {
		const rendered = renderSegment("model", createModelContext(true));
		expect(rendered.content).toContain("Test Model");
		// The badge carries the success color, kept distinct from the statusLineModel
		// name color (which several themes alias to `accent`).
		expect(rendered.content).toContain(theme.fg("success", "++"));
	});

	it("omits the badge when the advisor is inactive", () => {
		const rendered = renderSegment("model", createModelContext(false));
		expect(rendered.content).toContain("Test Model");
		expect(rendered.content).not.toContain("++");
	});
});

describe("status line context segment", () => {
	it("renders only the percentage in Claude style", () => {
		settings.set("renderStyle", "claude");
		const ctx = createModelContext(false);
		ctx.contextPercent = 3;
		ctx.contextTokens = 30_000;
		ctx.contextWindow = 1_000_000;
		ctx.autoCompactEnabled = true;

		const rendered = renderSegment("context_pct", ctx);

		expect(Bun.stripANSI(rendered.content)).toBe("3.0%");
		settings.set("renderStyle", "omp");
	});
});

describe("status line model segment compact thinking level", () => {
	function createThinkingContext(compactThinkingLevel: boolean): SegmentContext {
		return {
			...createModelContext(false),
			session: {
				state: {
					model: { id: "test-model", name: "Test Model", thinking: true },
					thinkingLevel: ThinkingLevel.High,
				},
				isFastModeActive: () => false,
				isAutoThinking: false,
				autoResolvedThinkingLevel: () => undefined,
				isAdvisorActive: () => false,
			} as unknown as SegmentContext["session"],
			compactThinkingLevel,
		};
	}

	it("trails the level as a ` · <level>` suffix when compact mode is off", () => {
		const display = theme.thinking.high;
		const modelPrefix = theme.icon.model ? `${theme.icon.model} ` : "";
		const rendered = renderSegment("model", createThinkingContext(false));
		expect(Bun.stripANSI(rendered.content)).toBe(`${modelPrefix}Test Model${theme.sep.dot}${display}`);
	});

	it("swaps the model icon for the level glyph and drops the suffix when compact", () => {
		const display = theme.thinking.high;
		const glyph = display.includes(" ") ? display.slice(0, display.indexOf(" ")) : display;
		const rendered = renderSegment("model", createThinkingContext(true));
		expect(Bun.stripANSI(rendered.content)).toBe(`${glyph} Test Model`);
		expect(Bun.stripANSI(rendered.content)).not.toContain(theme.sep.dot);
	});
});
