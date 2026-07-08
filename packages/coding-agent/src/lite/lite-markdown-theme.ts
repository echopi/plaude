import type { MarkdownTheme } from "@oh-my-pi/pi-tui";
import { getMarkdownTheme } from "../modes/theme/theme";
import { isLiteRender } from "./render-policy";

const ASCII_BOX = {
	topLeft: "+",
	topRight: "+",
	bottomLeft: "+",
	bottomRight: "+",
	horizontal: "-",
	vertical: "|",
	teeDown: "+",
	teeUp: "+",
	teeLeft: "+",
	teeRight: "+",
	cross: "+",
};

export function getLiteMarkdownTheme(): MarkdownTheme {
	const base = getMarkdownTheme();
	if (!isLiteRender()) return base;
	return {
		...base,
		symbols: {
			...base.symbols,
			table: ASCII_BOX,
			quoteBorder: ">",
			hrChar: "-",
		},
	};
}
