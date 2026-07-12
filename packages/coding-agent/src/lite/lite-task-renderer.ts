import { type Component, Text } from "@oh-my-pi/pi-tui";
import { formatDuration } from "@oh-my-pi/pi-utils";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import type { AgentProgress, SingleResult, TaskParams, TaskToolDetails } from "../task/types";
import { formatStatusIcon, previewLine, replaceTabs, truncateToWidth } from "../tools/render-utils";
import { useClaudeStatusLine } from "./render-policy";

type TaskResult = {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
	isError?: boolean;
};

function isTaskToolDetails(value: unknown): value is TaskToolDetails {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return Array.isArray(record.results) && typeof record.totalDurationMs === "number";
}

function taskArgs(value: unknown): TaskParams | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as TaskParams) : undefined;
}

function labelFromProgress(progress: AgentProgress): string {
	return progress.description?.trim() || progress.id || progress.agent || "task";
}

function labelFromResult(result: SingleResult): string {
	return result.description?.trim() || result.id || result.agent || "task";
}

function currentTool(progress: AgentProgress): string | undefined {
	if (progress.currentTool) {
		const detail = progress.lastIntent ?? progress.currentToolArgs;
		return detail ? `${progress.currentTool}: ${previewLine(replaceTabs(detail), 42)}` : progress.currentTool;
	}
	const recent = progress.recentTools[0];
	return recent ? `${recent.tool} done` : undefined;
}

function renderLine(line: string, theme: Theme, color: "dim" | "text" | "error" = "text"): Component {
	return new Text(theme.fg(color, truncateToWidth(line, 120)), useClaudeStatusLine() ? 2 : 0, 0);
}

function runningLine(progress: AgentProgress, options: RenderResultOptions, theme: Theme): string {
	const spinner = formatStatusIcon("running", theme, options.spinnerFrame);
	const tool = currentTool(progress) ?? "running";
	const elapsed = progress.currentToolStartMs ? Date.now() - progress.currentToolStartMs : progress.durationMs;
	const elapsedSuffix = elapsed > 0 ? ` (${formatDuration(elapsed)})` : "";
	return `${spinner} ${labelFromProgress(progress)} - ${tool}${elapsedSuffix}`;
}

function finalLine(result: SingleResult, theme: Theme): string {
	const icon =
		result.aborted || result.exitCode !== 0 || result.error
			? formatStatusIcon("error", theme)
			: formatStatusIcon("success", theme);
	const status = result.aborted ? "aborted" : result.exitCode !== 0 ? `failed exit ${result.exitCode}` : "completed";
	const summary = result.error
		? previewLine(replaceTabs(result.error), 68)
		: result.lastIntent
			? previewLine(replaceTabs(result.lastIntent), 68)
			: `${result.requests} req, ${formatDuration(result.durationMs)}`;
	return `${icon} ${labelFromResult(result)} - ${status}: ${summary}`;
}

export function renderLiteTaskResult(
	result: TaskResult,
	options: RenderResultOptions,
	theme: Theme,
	args?: unknown,
): Component {
	const details = isTaskToolDetails(result.details) ? result.details : undefined;
	const task = taskArgs(args);
	if (!details) {
		const text = result.content.find(item => item.type === "text")?.text;
		const icon = result.isError ? formatStatusIcon("error", theme) : formatStatusIcon("success", theme);
		const label = task?.agent?.trim() || "task";
		const summary = text ? `: ${previewLine(replaceTabs(text), 72)}` : "";
		return renderLine(
			`${icon} ${label} - ${result.isError ? "error" : "completed"}${summary}`,
			theme,
			result.isError ? "error" : "text",
		);
	}

	if (options.isPartial && details.progress && details.progress.length > 0) {
		const running = [...details.progress]
			.reverse()
			.find(item => item.status === "running" || item.status === "pending");
		if (running) return renderLine(runningLine(running, options, theme), theme, "dim");
	}

	const failed = details.results.find(item => item.aborted || item.exitCode !== 0 || item.error);
	const latest = failed ?? details.results[details.results.length - 1];
	if (latest) return renderLine(finalLine(latest, theme), theme, failed ? "error" : "text");

	const spinner = formatStatusIcon("running", theme, options.spinnerFrame);
	const label = task?.task?.trim() || task?.agent?.trim() || "task";
	return renderLine(`${spinner} ${label} - pending`, theme, "dim");
}
