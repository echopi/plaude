import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ThemeSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/theme-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { SgrMouseEvent } from "@oh-my-pi/pi-tui";
import { filterLiteThemes } from "../src/lite/lite-theme-filter";

function leftClick(line: number): SgrMouseEvent {
	return { button: 0, col: 0, row: line, release: false, wheel: null, motion: false, leftClick: true };
}

describe("lite theme filtering", () => {
	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { renderStyle: "claude" } });
		await initTheme();
	});

	afterEach(() => {
		resetSettingsForTest();
	});

	it("keeps only the three lite theme choices when they are available", () => {
		expect(filterLiteThemes(["alpha", "dark", "light", "dark-monochrome", "zeta"])).toEqual([
			"dark",
			"light",
			"dark-monochrome",
		]);
	});

	it("filters ThemeSelectorComponent options in lite mode", () => {
		let selected: string | undefined;
		const component = new ThemeSelectorComponent(
			"alpha",
			["alpha", "dark", "light", "dark-monochrome", "zeta"],
			value => {
				selected = value;
			},
			() => {},
			() => {},
		);

		component.render(80);
		component.routeMouse(leftClick(1), 1, 0);
		expect(selected).toBe("dark");

		component.routeMouse(leftClick(2), 2, 0);
		expect(selected).toBe("light");

		component.routeMouse(leftClick(3), 3, 0);
		expect(selected).toBe("dark-monochrome");
	});
});
