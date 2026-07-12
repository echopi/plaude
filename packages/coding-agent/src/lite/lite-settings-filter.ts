import type { SettingPath, SettingTab } from "../config/settings-schema";
import type { SettingDef } from "../modes/components/settings-defs";
import { isLiteRender } from "./render-policy";

export const LITE_CORE_SETTING_PATHS = [
	"renderStyle",
	"theme.dark",
	"theme.light",
	"statusLine.preset",
	"defaultThinkingLevel",
	"hideThinkingBlock",
	"tools.approvalMode",
	"plan.enabled",
	"memory.backend",
	"edit.mode",
	"bash.enabled",
] as const satisfies readonly SettingPath[];

const LITE_CORE_SETTINGS = new Set<SettingPath>(LITE_CORE_SETTING_PATHS);

export function isLiteCoreSetting(path: SettingPath): boolean {
	return LITE_CORE_SETTINGS.has(path);
}

export function getLiteSettingsForTab(
	tab: SettingTab,
	defs: readonly SettingDef[],
	advancedOpen: boolean,
): SettingDef[] {
	if (!isLiteRender() || advancedOpen) return [...defs];
	return defs.filter(def => def.tab === tab && isLiteCoreSetting(def.path));
}

export function hasLiteAdvancedSettings(tab: SettingTab, defs: readonly SettingDef[]): boolean {
	return isLiteRender() && defs.some(def => def.tab === tab && !isLiteCoreSetting(def.path));
}
