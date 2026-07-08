import { isSettingsInitialized, settings } from "../config/settings";

export type RenderDensity = "lite" | "full";

function prefersLegacyTestRender(): boolean {
	return process.env.NODE_ENV === "test" && process.env.OMP_LITE_RENDER_TEST !== "1";
}

export function getRenderDensity(expanded = false): RenderDensity {
	if (expanded) return "full";
	if (!isSettingsInitialized()) return "full";
	if (!settings.get("liteMode")) return "full";
	return prefersLegacyTestRender() ? "full" : "lite";
}

export function isLiteRender(expanded = false): boolean {
	return getRenderDensity(expanded) === "lite";
}

export function useClaudeStatusLine(): boolean {
	return process.env.PLAUDE_STATUSLINE_STYLE === "claude";
}
