import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	assertSubmittable,
	buildVerificationCommands,
	classifyRelease,
	type MaintainerState,
	parseGitHubRelease,
	redactSecrets,
	renderLaunchAgent,
} from "./plaude-maintain";

async function run(argv: string[], cwd: string): Promise<string> {
	const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`${argv.join(" ")} failed (${exitCode}):\n${stdout}\n${stderr}`);
	return stdout;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
	return run(["git", ...args], cwd);
}

describe("parseGitHubRelease", () => {
	it("accepts a stable semantic release", () => {
		expect(
			parseGitHubRelease({
				tag_name: "v16.4.1",
				name: "v16.4.1",
				html_url: "https://github.com/can1357/oh-my-pi/releases/tag/v16.4.1",
				published_at: "2026-07-10T19:09:33Z",
				draft: false,
				prerelease: false,
			}),
		).toEqual({
			tag: "v16.4.1",
			name: "v16.4.1",
			url: "https://github.com/can1357/oh-my-pi/releases/tag/v16.4.1",
			publishedAt: "2026-07-10T19:09:33Z",
		});
	});

	it("rejects drafts, prereleases, and non-semver tags", () => {
		for (const release of [
			{ tag_name: "v16.4.2", draft: true, prerelease: false },
			{ tag_name: "v16.5.0-beta.1", draft: false, prerelease: true },
			{ tag_name: "nightly", draft: false, prerelease: false },
		]) {
			expect(() => parseGitHubRelease(release)).toThrow();
		}
	});
});

describe("classifyRelease", () => {
	it("reports a release once and treats the recorded tag as seen", () => {
		const release = {
			tag: "v16.4.1",
			name: "v16.4.1",
			url: "https://example.test/v16.4.1",
			publishedAt: "2026-07-10T19:09:33Z",
		};
		expect(classifyRelease({}, release).isNew).toBe(true);
		expect(classifyRelease({ lastSeenTag: "v16.4.1" }, release).isNew).toBe(false);
	});
});

describe("buildVerificationCommands", () => {
	it("combines fork regressions with changed test files", () => {
		const commands = buildVerificationCommands([
			"packages/ai/src/providers/openai-codex-responses.ts",
			"packages/catalog/test/codex-discovery.test.ts",
			"packages/tui/test/markdown.test.ts",
		]);
		expect(commands.map(command => command.join(" "))).toEqual([
			"bun install --frozen-lockfile",
			"bun check",
			"bun scripts/prepare-maintenance-native.ts",
			"bun test packages/ai/test/openai-codex-stream.test.ts packages/coding-agent/test/sdk-mcp-notification-uri.test.ts packages/coding-agent/test/lite-render-policy.test.ts packages/coding-agent/test/lite-theme-filter.test.ts",
			"bun test packages/catalog/test/codex-discovery.test.ts packages/tui/test/markdown.test.ts",
		]);
	});

	it("deduplicates changed tests and ignores source-only paths", () => {
		const commands = buildVerificationCommands([
			"packages/coding-agent/src/sdk.ts",
			"packages/coding-agent/test/oauth-flow.test.ts",
			"packages/coding-agent/test/oauth-flow.test.ts",
		]);
		expect(commands.at(-1)?.join(" ")).toBe("bun test packages/coding-agent/test/oauth-flow.test.ts");
	});
});

describe("assertSubmittable", () => {
	const verifiedState: MaintainerState = {
		active: {
			tag: "v16.4.1",
			branch: "maintain/v16.4.1",
			worktree: "/tmp/plaude-v16.4.1",
			baseSha: "base",
			status: "verified",
			verifiedSha: "verified",
		},
	};

	it("accepts only the exact verified commit", () => {
		expect(() => assertSubmittable(verifiedState, "verified")).not.toThrow();
		expect(() => assertSubmittable(verifiedState, "changed-after-verify")).toThrow("changed after verification");
	});

	it("rejects prepared or failed syncs", () => {
		const state = structuredClone(verifiedState);
		if (!state.active) throw new Error("fixture missing active sync");
		state.active.status = "verify-failed";
		expect(() => assertSubmittable(state, "verified")).toThrow("not verified");
	});
});

describe("renderLaunchAgent", () => {
	it("renders an explicit watch command without embedding credentials", () => {
		const plist = renderLaunchAgent({
			bunPath: "/Users/me/.bun/bin/bun",
			scriptPath: "/repo/scripts/plaude-maintain.ts",
			repoPath: "/repo & fork",
			stateDir: "/Users/me/.local/state/plaude-maintainer",
			intervalSeconds: 1800,
		});
		expect(plist).toContain("<string>watch</string>");
		expect(plist).toContain("<string>--once</string>");
		expect(plist).toContain("/repo &amp; fork");
		expect(plist).not.toContain("token");
	});
});

describe("redactSecrets", () => {
	it("removes URL credentials and token query values from receipts", () => {
		expect(redactSecrets("fetch https://user:secret@example.test/repo?access_token=abc123&x=1")).toBe(
			"fetch https://***:***@example.test/repo?access_token=***&x=1",
		);
	});
});

describe("sync command", () => {
	it("merges an exact upstream tag in an isolated worktree", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "plaude-maintain-test-"));
		try {
			const upstream = path.join(root, "upstream");
			const fork = path.join(root, "fork.git");
			const repo = path.join(root, "repo");
			const stateDir = path.join(root, "state");
			await fs.mkdir(upstream);
			await git(upstream, "init", "-b", "main");
			await git(upstream, "config", "user.name", "Plaude Test");
			await git(upstream, "config", "user.email", "plaude-test@example.invalid");
			await Bun.write(path.join(upstream, "base.txt"), "base\n");
			await git(upstream, "add", "base.txt");
			await git(upstream, "commit", "-m", "base");
			await git(root, "init", "--bare", fork);
			await git(upstream, "remote", "add", "fork", fork);
			await git(upstream, "push", "fork", "HEAD:refs/heads/auto/upstream-sync");

			await Bun.write(path.join(upstream, "release.txt"), "v1.2.3\n");
			await git(upstream, "add", "release.txt");
			await git(upstream, "commit", "-m", "release");
			await git(upstream, "tag", "v1.2.3");

			await git(root, "clone", fork, repo);
			await git(repo, "checkout", "-b", "auto/upstream-sync", "origin/auto/upstream-sync");
			await git(repo, "config", "user.name", "Plaude Test");
			await git(repo, "config", "user.email", "plaude-test@example.invalid");
			const cli = path.join(import.meta.dir, "plaude-maintain.ts");
			await run(
				[
					process.execPath,
					cli,
					"sync",
					"v1.2.3",
					"--repo",
					repo,
					"--state-dir",
					stateDir,
					"--upstream-url",
					upstream,
				],
				repo,
			);

			const state = (await Bun.file(path.join(stateDir, "state.json")).json()) as MaintainerState;
			expect(state.active?.status).toBe("prepared");
			expect(state.active?.tag).toBe("v1.2.3");
			expect(await Bun.file(path.join(state.active?.worktree ?? "", "release.txt")).text()).toBe("v1.2.3\n");
			expect(state.active?.worktree.startsWith(repo)).toBe(false);

			if (!state.active) throw new Error("sync did not create active state");
			const verifiedSha = (await git(state.active.worktree, "rev-parse", "HEAD")).trim();
			state.active.status = "verified";
			state.active.verifiedSha = verifiedSha;
			await Bun.write(path.join(stateDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
			await run([process.execPath, cli, "submit", "--repo", repo, "--state-dir", stateDir], repo);
			expect((await git(repo, "rev-parse", "HEAD")).trim()).toBe(verifiedSha);
			expect((await git(root, `--git-dir=${fork}`, "rev-parse", "refs/heads/auto/upstream-sync")).trim()).toBe(
				verifiedSha,
			);

			await run([process.execPath, cli, "cleanup", "--repo", repo, "--state-dir", stateDir], repo);
			await Bun.write(path.join(upstream, "superseding.txt"), "v1.2.4\n");
			await git(upstream, "add", "superseding.txt");
			await git(upstream, "commit", "-m", "superseding release");
			await git(upstream, "tag", "v1.2.4");
			await run(
				[
					process.execPath,
					cli,
					"sync",
					"v1.2.4",
					"--repo",
					repo,
					"--state-dir",
					stateDir,
					"--upstream-url",
					upstream,
				],
				repo,
			);
			const superseded = (await Bun.file(path.join(stateDir, "state.json")).json()) as MaintainerState;
			const abandonedWorktree = superseded.active?.worktree;
			await run([process.execPath, cli, "abandon", "--repo", repo, "--state-dir", stateDir], repo);
			const abandoned = (await Bun.file(path.join(stateDir, "state.json")).json()) as MaintainerState;
			expect(abandoned.active).toBeUndefined();
			expect(await Bun.file(abandonedWorktree ?? "").exists()).toBe(false);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	}, 15_000);
});
