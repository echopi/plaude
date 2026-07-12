import { isSettingsInitialized, settings } from "../config/settings";

export type RenderDensity = "lite" | "full";

/** Whether the user has opted into the restrained Claude Code-style TUI. */
export function isClaudeStyle(): boolean {
	if (!isSettingsInitialized()) return false;
	return settings.get("renderStyle") === "claude";
}

export function getRenderDensity(expanded = false): RenderDensity {
	if (expanded) return "full";
	return isClaudeStyle() ? "lite" : "full";
}

export function isLiteRender(expanded = false): boolean {
	return getRenderDensity(expanded) === "lite";
}
