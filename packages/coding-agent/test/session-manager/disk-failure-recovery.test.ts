import { describe, expect, it } from "bun:test";
import { loadEntriesFromFile } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { MemorySessionStorage, type SessionStorageWriter } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import { makeAssistantMessage } from "./helpers";

class EnospcError extends Error {
	readonly code = "ENOSPC";
}

class RecoverableEnospcStorage extends MemorySessionStorage {
	#failNextAppend = false;

	armAppendFailure(): void {
		this.#failNextAppend = true;
	}

	override openWriter(
		path: string,
		options?: { flags?: "a" | "w"; onError?: (err: Error) => void },
	): SessionStorageWriter {
		const inner = super.openWriter(path, options);
		let writerError: Error | undefined;
		return {
			append: line => {
				if (writerError) return Promise.reject(writerError);
				if (this.#failNextAppend) {
					this.#failNextAppend = false;
					writerError = new EnospcError("ENOSPC: no space left on device, write");
					options?.onError?.(writerError);
					return Promise.reject(writerError);
				}
				return inner.append(line);
			},
			flush: () => (writerError ? Promise.reject(writerError) : inner.flush()),
			isOpen: () => inner.isOpen(),
			async close() {
				await inner.close();
				if (writerError) throw writerError;
			},
			getError: () => writerError ?? inner.getError(),
		};
	}
}

describe("SessionManager disk failure recovery", () => {
	it("reopens a poisoned writer and rewrites every in-memory entry exactly once", async () => {
		const storage = new RecoverableEnospcStorage();
		const session = SessionManager.create("/cwd", "/sessions", storage);
		session.appendMessage(makeAssistantMessage());
		session.appendMessage({ role: "user", content: "prime", timestamp: 1 });
		await session.flush();

		storage.armAppendFailure();
		session.appendMessage({ role: "user", content: "before-rename", timestamp: 2 });
		await expect(session.setSessionName("Recovered session", "user")).resolves.toBe(true);

		storage.armAppendFailure();
		session.appendMessage({ role: "user", content: "before-fork", timestamp: 3 });
		await expect(session.flush()).resolves.toBeUndefined();
		await expect(session.fork()).resolves.toBeDefined();

		storage.armAppendFailure();
		session.appendMessage({ role: "user", content: "before-append", timestamp: 4 });
		session.appendMessage({ role: "user", content: "after-append", timestamp: 5 });
		await expect(session.flush()).resolves.toBeUndefined();

		const sessionFile = session.getSessionFile();
		if (!sessionFile) throw new Error("Expected recovered session file");
		const entries = await loadEntriesFromFile(sessionFile, storage);
		const header = entries.find(entry => entry.type === "session");
		const userContents = entries.flatMap(entry =>
			entry.type === "message" && entry.message.role === "user" ? [entry.message.content] : [],
		);
		const entryIds = entries.flatMap(entry => ("id" in entry && entry.type !== "session" ? [entry.id] : []));

		expect(header?.title).toBe("Recovered session");
		expect(userContents).toEqual(["prime", "before-rename", "before-fork", "before-append", "after-append"]);
		expect(new Set(entryIds).size).toBe(entryIds.length);
	});

	const recoveryActions = {
		ensureOnDisk: (session: SessionManager) => session.ensureOnDisk(),
		flushSync: (session: SessionManager) => session.flushSync(),
		close: (session: SessionManager) => session.close(),
	};

	for (const [operation, recover] of Object.entries(recoveryActions)) {
		it(`restores pending entries when ${operation} is the first operation after ENOSPC`, async () => {
			const storage = new RecoverableEnospcStorage();
			const session = SessionManager.create("/cwd", "/sessions", storage);
			session.appendMessage(makeAssistantMessage());
			await session.flush();

			storage.armAppendFailure();
			session.appendMessage({ role: "user", content: operation, timestamp: 1 });
			await recover(session);

			const sessionFile = session.getSessionFile();
			if (!sessionFile) throw new Error("Expected recovered session file");
			const entries = await loadEntriesFromFile(sessionFile, storage);
			const userContents = entries.flatMap(entry =>
				entry.type === "message" && entry.message.role === "user" ? [entry.message.content] : [],
			);
			expect(userContents).toEqual([operation]);
		});
	}
});
