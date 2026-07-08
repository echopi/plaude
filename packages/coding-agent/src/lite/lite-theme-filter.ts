const LITE_THEME_CHOICES = ["dark", "light", "dark-monochrome"] as const;

export function filterLiteThemes(themes: readonly string[]): string[] {
	const available = new Set(themes);
	const filtered = LITE_THEME_CHOICES.filter(theme => available.has(theme));
	return filtered.length > 0 ? filtered : [...themes];
}
