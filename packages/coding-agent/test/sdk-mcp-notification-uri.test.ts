import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { removeSyncWithRetries, Snowflake } from "@oh-my-pi/pi-utils";

describe("MCP notification resource read hints", () => {
	const tempDirs: string[] = [];

	afterAll(() => {
		for (const tempDir of tempDirs.splice(0)) {
			removeSyncWithRetries(tempDir);
		}
	});

	it("emits an exact read path for resource URIs that embed their own scheme", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-sdk-mcp-notification-uri-${Snowflake.next()}-`));
		tempDirs.push(tempDir);
		const cwd = path.join(tempDir, "project");
		const agentDir = path.join(tempDir, "agent");
		fs.mkdirSync(cwd, { recursive: true });
		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settings: Settings.isolated({ "mcp.notifications": true }),
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			modelRegistry,
		});

		try {
			session.yieldQueue.enqueue("mcp-notification", { serverName: "dingtalk", uri: "dingtalk://messages" });
			const [buildMessage] = session.yieldQueue.drainLazy();
			const message = buildMessage?.();
			expect(message).toBeDefined();
			expect(message?.role).toBe("user");
			const firstContent = message?.role === "user" ? message.content[0] : undefined;
			const text =
				typeof firstContent === "string" ? firstContent : firstContent?.type === "text" ? firstContent.text : "";

			expect(text).toContain('read(path="mcp://dingtalk://messages")');
			expect(text).not.toContain("mcp://dingtalk/messages");
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});
});
