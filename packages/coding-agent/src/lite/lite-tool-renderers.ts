import { type Component, Container, Text } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { formatStatusIcon, previewLine, replaceTabs, truncateToWidth } from "../tools/render-utils";
import type { ToolRenderer } from "../tools/renderers";
import { renderLiteTaskResult } from "./lite-task-renderer";

type ToolResult = {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
	isError?: boolean;
};

const SEARCH_ARG_TOOLS = new Set(["grep", "glob", "search_tool_bm25", "web_search"]);
const EDIT_DIFF_CONTEXT_LINES = 3;
const EDIT_DIFF_MAX_LINES = 20;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringifyBrief(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return `${value.length} items`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).filter(key => key !== "__partialJson");
		if (keys.length === 0) return undefined;
		return keys
			.slice(0, 3)
			.map(key => `${key}:${stringifyBrief(record[key]) ?? "..."}`)
			.join(" ");
	}
	return undefined;
}

function argSummary(toolName: string, args: unknown): string {
	const record = asRecord(args);
	if (!record) return "";
	const preferredKeys =
		toolName === "bash"
			? ["command", "cmd", "description"]
			: toolName === "eval"
				? ["code", "language"]
				: toolName === "edit" || toolName === "apply_patch" || toolName === "write" || toolName === "read"
					? ["path", "file_path", "op", "content"]
					: SEARCH_ARG_TOOLS.has(toolName)
						? ["pattern", "query", "path", "glob"]
						: toolName === "task"
							? ["agent", "description", "assignment"]
							: Object.keys(record)
									.filter(key => key !== "__partialJson")
									.slice(0, 3);
	const parts: string[] = [];
	for (const key of preferredKeys) {
		if (!(key in record)) continue;
		const brief = stringifyBrief(record[key]);
		if (brief) parts.push(key === "command" || key === "query" || key === "pattern" ? brief : `${key}:${brief}`);
	}
	const summary = parts.join(" ");
	return summary ? previewLine(replaceTabs(summary), 56) : "";
}

function textOutput(result: ToolResult): string {
	return result.content
		.filter(item => item.type === "text" && item.text)
		.map(item => item.text)
		.join("\n");
}

function exitSummary(details: unknown): string | undefined {
	const record = asRecord(details);
	if (!record) return undefined;
	const exitCode = record.exitCode;
	if (typeof exitCode === "number") return `exit ${exitCode}`;
	const perFileResults = record.perFileResults;
	if (Array.isArray(perFileResults)) return `${perFileResults.length} files`;
	return undefined;
}

function importantLine(output: string, isError: boolean | undefined): string | undefined {
	const lines = output
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
	const matched = lines.find(line => /error|warn|failed|fatal|exception/i.test(line));
	return matched ?? (isError ? lines[0] : undefined);
}

function resultSummary(result: ToolResult): string {
	const output = replaceTabs(textOutput(result));
	const status = result.isError ? "error" : (exitSummary(result.details) ?? "ok");
	const line = importantLine(output, result.isError);
	return line ? `${status}: ${previewLine(line, 72)}` : status;
}

function renderLine(text: string, theme: Theme, color: "dim" | "text" | "error" = "text"): Component {
	return new Text(theme.fg(color, truncateToWidth(text, 120)), 0, 0);
}

function diffTextFromDetails(details: unknown): string | undefined {
	const record = asRecord(details);
	if (!record) return undefined;
	const diff = record.diff;
	if (typeof diff === "string" && diff.trim()) return diff;
	const perFileResults = record.perFileResults;
	if (!Array.isArray(perFileResults)) return undefined;
	const diffs = perFileResults
		.map(item => asRecord(item)?.diff)
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
	return diffs.length > 0 ? diffs.join("\n") : undefined;
}

function shouldKeepDiffLine(index: number, changedIndices: readonly number[]): boolean {
	for (const changedIndex of changedIndices) {
		if (Math.abs(index - changedIndex) <= EDIT_DIFF_CONTEXT_LINES) return true;
	}
	return false;
}

function compactHunk(lines: readonly string[]): string[] {
	const [header, ...body] = lines;
	const changedIndices = body
		.map((line, index) => (line.startsWith("+") || line.startsWith("-") ? index : -1))
		.filter(index => index >= 0);
	if (changedIndices.length === 0) return [...lines];

	const output = [header];
	let skipped = false;
	for (let index = 0; index < body.length; index++) {
		if (shouldKeepDiffLine(index, changedIndices)) {
			if (skipped) {
				output.push(" ...");
				skipped = false;
			}
			output.push(body[index]);
		} else {
			skipped = true;
		}
	}
	return output;
}

function compactDiffLines(diff: string): string[] {
	const lines = diff.split("\n").filter(line => line.length > 0);
	const output: string[] = [];
	let hunk: string[] = [];

	const flushHunk = () => {
		if (hunk.length === 0) return;
		output.push(...compactHunk(hunk));
		hunk = [];
	};

	for (const line of lines) {
		if (line.startsWith("@@")) {
			flushHunk();
			hunk = [line];
		} else if (hunk.length > 0) {
			hunk.push(line);
		} else if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
			output.push(line);
		}
	}
	flushHunk();
	return output;
}

function renderDiffLine(line: string, theme: Theme): Component {
	const color = line.startsWith("+") && !line.startsWith("+++") ? "success" : line.startsWith("-") ? "error" : "dim";
	return new Text(theme.fg(color, truncateToWidth(line, 120)), 0, 0);
}

function renderLiteEditResult(
	result: ToolResult,
	options: RenderResultOptions,
	theme: Theme,
	args?: unknown,
): Component {
	const baseRenderer = createLiteRenderer("edit");
	const summary = baseRenderer.renderResult(result, options, theme, args);
	const diff = diffTextFromDetails(result.details);
	if (!diff) return summary;

	const compact = compactDiffLines(diff);
	if (compact.length === 0) return summary;

	const container = new Container();
	container.addChild(summary);
	if (compact.length > EDIT_DIFF_MAX_LINES) {
		container.addChild(renderLine(`diff ${compact.length} lines folded; ctrl+o for full output`, theme, "dim"));
		return container;
	}

	for (const line of compact) {
		container.addChild(renderDiffLine(line, theme));
	}
	return container;
}

function createLiteRenderer(toolName: string): ToolRenderer {
	return {
		mergeCallAndResult: true,
		inline: true,
		animatedPendingPreview: true,
		animatedPartialResult: true,
		renderCall: (args: unknown, options: RenderResultOptions, theme: Theme): Component => {
			const spinner = formatStatusIcon("running", theme, options.spinnerFrame);
			const summary = argSummary(toolName, args);
			const suffix = summary ? `(${summary})` : "";
			return renderLine(`${spinner} ${toolName}${suffix}`, theme, "dim");
		},
		renderResult: (result: ToolResult, _options: RenderResultOptions, theme: Theme, args?: unknown): Component => {
			const icon = result.isError ? formatStatusIcon("error", theme) : formatStatusIcon("success", theme);
			const summary = argSummary(toolName, args);
			const suffix = summary ? `(${summary})` : "";
			const color = result.isError ? "error" : "text";
			return renderLine(`${icon} ${toolName}${suffix} -> ${resultSummary(result)}`, theme, color);
		},
	};
}

export const liteToolRenderers: Record<string, ToolRenderer> = {
	bash: createLiteRenderer("bash"),
	browser: createLiteRenderer("browser"),
	eval: createLiteRenderer("eval"),
	edit: {
		...createLiteRenderer("edit"),
		renderResult: renderLiteEditResult,
	},
	apply_patch: createLiteRenderer("apply_patch"),
	glob: createLiteRenderer("glob"),
	grep: createLiteRenderer("grep"),
	github: createLiteRenderer("github"),
	read: createLiteRenderer("read"),
	search_tool_bm25: createLiteRenderer("search_tool_bm25"),
	task: {
		...createLiteRenderer("task"),
		renderResult: renderLiteTaskResult,
	},
	web_search: createLiteRenderer("web_search"),
	write: createLiteRenderer("write"),
};

export function getLiteToolRenderer(toolName: string): ToolRenderer {
	return liteToolRenderers[toolName] ?? createLiteRenderer(toolName);
}
