import type { PresetDef } from "../modes/components/status-line/types";

export const liteStatusPreset: PresetDef = {
	leftSegments: ["model", "context_pct"],
	rightSegments: ["usage"],
	separator: "pipe",
	segmentOptions: {
		model: { showThinkingLevel: true },
	},
};
