import { isSettingsInitialized, settings } from "../config/settings";

export type RenderDensity = "lite" | "full";

/** Whether the user has opted into the restrained Claude Code-style TUI. */
export function isClaudeStyle(): boolean {
	if (!isSettingsInitialized()) return false;
	return settings.get("renderStyle") === "claude";
}

/**
 * Compatibility shim for components that still gate on the legacy
 * `PLAUDE_STATUSLINE_STYLE` env var. Honors the env var directly (so installed
 * Plaude wrappers keep working before settings init) and falls back to the
 * `renderStyle` setting.
 */
export function useClaudeStatusLine(): boolean {
	if (process.env.PLAUDE_STATUSLINE_STYLE === "claude") return true;
	return isClaudeStyle();
}

export function getRenderDensity(expanded = false): RenderDensity {
	if (expanded) return "full";
	return isClaudeStyle() ? "lite" : "full";
}

export function isLiteRender(expanded = false): boolean {
	return getRenderDensity(expanded) === "lite";
}
