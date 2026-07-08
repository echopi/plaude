import type { PresetDef } from "../modes/components/status-line/types";

export const liteStatusPreset: PresetDef = {
	leftSegments: ["model"],
	rightSegments: ["token_total", "time_spent"],
	separator: "pipe",
	segmentOptions: {
		model: { showThinkingLevel: false },
	},
};
