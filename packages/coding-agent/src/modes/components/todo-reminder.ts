import { Box, Container, Spacer, Text } from "@oh-my-pi/pi-tui";
import { useClaudeStatusLine } from "../../lite/render-policy";
import { theme } from "../../modes/theme/theme";
import type { TodoItem } from "../../tools/todo";

/**
 * Component that renders a todo completion reminder notification, committed into
 * the transcript like a TTSR notification so it stays anchored in history rather
 * than floating above the editor.
 * Shows when the agent stops with incomplete todos.
 */
export class TodoReminderComponent extends Container {
	#box: Box;

	constructor(
		private readonly todos: TodoItem[],
		private readonly attempt: number,
		private readonly maxAttempts: number,
	) {
		super();

		this.addChild(new Spacer(1));

		this.#box = new Box(1, 1, t => theme.inverse(theme.fg("warning", t)));
		this.#box.setIgnoreTight(true);
		this.addChild(this.#box);

		this.#rebuild();
	}

	override render(width: number): readonly string[] {
		if (!useClaudeStatusLine()) return super.render(width);

		const count = this.todos.length;
		const label = count === 1 ? "todo" : "todos";
		const header = theme.fg(
			"warning",
			`${theme.icon.warning} ${count} incomplete ${label} · reminder ${this.attempt}/${this.maxAttempts}`,
		);
		const todoList = this.todos.map(todo => `  ${theme.checkbox.unchecked} ${theme.italic(todo.content)}`).join("\n");
		const text = new Text(`${header}\n\n${todoList}`, 2, 0).setIgnoreTight(true);
		const block = new Container();
		block.addChild(new Spacer(1));
		block.addChild(text);
		return block.render(width);
	}

	#rebuild(): void {
		this.#box.clear();

		const count = this.todos.length;
		const label = count === 1 ? "todo" : "todos";
		const header = `${theme.icon.warning} ${count} incomplete ${label} - reminder ${this.attempt}/${this.maxAttempts}`;

		this.#box.addChild(new Text(header, 0, 0));
		this.#box.addChild(new Spacer(1));

		const todoList = this.todos.map(todo => `  ${theme.checkbox.unchecked} ${todo.content}`).join("\n");
		this.#box.addChild(new Text(theme.italic(todoList), 0, 0));
	}
}
