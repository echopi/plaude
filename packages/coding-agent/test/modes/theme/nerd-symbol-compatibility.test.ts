import { beforeAll, describe, expect, it } from "bun:test";
import { initTheme, type SymbolKey, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

const TAB_KEYS: SymbolKey[] = [
	"tab.appearance",
	"tab.model",
	"tab.interaction",
	"tab.context",
	"tab.files",
	"tab.shell",
	"tab.tools",
	"tab.memory",
	"tab.tasks",
	"tab.providers",
];

const TOOL_KEYS: SymbolKey[] = [
	"tool.write",
	"tool.edit",
	"tool.bash",
	"tool.ssh",
	"tool.lsp",
	"tool.gh",
	"tool.webSearch",
	"tool.exa",
	"tool.browser",
	"tool.eval",
	"tool.debug",
	"tool.mcp",
	"tool.job",
	"tool.task",
	"tool.todo",
	"tool.memory",
	"tool.ask",
	"tool.resolve",
	"tool.review",
	"tool.inspectImage",
	"tool.goal",
	"tool.irc",
	"tool.delete",
	"tool.move",
];

const LANGUAGES = [
	"typescript",
	"javascript",
	"python",
	"rust",
	"go",
	"java",
	"c",
	"cpp",
	"csharp",
	"ruby",
	"julia",
	"php",
	"swift",
	"kotlin",
	"shell",
	"html",
	"css",
	"json",
	"yaml",
	"markdown",
	"sql",
	"docker",
	"lua",
	"text",
	"env",
	"toml",
	"xml",
	"ini",
	"conf",
	"log",
	"csv",
	"tsv",
	"image",
	"pdf",
	"zip",
	"bin",
];

function isCompatibleNerdGlyph(symbol: string): boolean {
	const codePoint = symbol.codePointAt(0);
	if (codePoint === undefined) return true;
	const isPrivateUse =
		(codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
		(codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
		(codePoint >= 0x100000 && codePoint <= 0x10fffd);
	if (!isPrivateUse) return true;
	const isPowerline = codePoint >= 0xe0a0 && codePoint <= 0xe0d4;
	const isClassicFontAwesome = codePoint >= 0xf000 && codePoint <= 0xf2e0;
	return isPowerline || isClassicFontAwesome;
}

beforeAll(async () => {
	await initTheme(false, "nerd");
});

describe("nerd symbol compatibility", () => {
	it("keeps built-in UI icons within broadly supported Nerd Font ranges", () => {
		const symbols = [
			...Object.entries(theme.icon).map(([key, symbol]) => [`icon.${key}`, symbol] as const),
			...TAB_KEYS.map(key => [key, theme.symbol(key)] as const),
			...TOOL_KEYS.map(key => [key, theme.symbol(key)] as const),
			...LANGUAGES.map(lang => [`lang.${lang}`, theme.getLangIcon(lang)] as const),
			...theme.getSpinnerFrames("status").map((symbol, index) => [`spinner.status.${index}`, symbol] as const),
		];
		const incompatible = symbols
			.filter(([, symbol]) => !isCompatibleNerdGlyph(symbol))
			.map(([key, symbol]) => `${key}=U+${symbol.codePointAt(0)?.toString(16).toUpperCase()}`);

		expect(incompatible).toEqual([]);
	});
});
