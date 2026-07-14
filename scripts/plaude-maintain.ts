#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type SyncStatus = "prepared" | "conflict" | "verify-failed" | "verified" | "submitted";

export interface ActiveSync {
	tag: string;
	branch: string;
	worktree: string;
	baseSha: string;
	status: SyncStatus;
	verifiedSha?: string;
	submittedSha?: string;
	receiptDir?: string;
}

export interface MaintainerState {
	lastSeenTag?: string;
	lastSubmittedTag?: string;
	active?: ActiveSync;
}

export interface GitHubRelease {
	tag: string;
	name: string;
	url: string;
	publishedAt: string;
}

interface CliOptions {
	command: string;
	positionals: string[];
	repoPath: string;
	stateDir: string;
	upstreamUrl: string;
	forkRemote: string;
	workBranch: string;
	releaseApiUrl: string;
	intervalSeconds: number;
	once: boolean;
	install: boolean;
	json: boolean;
}

interface LaunchAgentOptions {
	bunPath: string;
	scriptPath: string;
	repoPath: string;
	stateDir: string;
	intervalSeconds: number;
}

class CommandError extends Error {
	constructor(
		readonly argv: string[],
		readonly exitCode: number,
		readonly stdout: string,
		readonly stderr: string,
	) {
		super(`Command failed (${exitCode}): ${argv.join(" ")}`);
	}
}

const FORK_REGRESSION_COMMAND = [
	"bun",
	"test",
	"packages/ai/test/openai-codex-stream.test.ts",
	"packages/coding-agent/test/sdk-mcp-notification-uri.test.ts",
	"packages/coding-agent/test/lite-render-policy.test.ts",
	"packages/coding-agent/test/lite-theme-filter.test.ts",
];

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Expected an object");
	}
	return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Release field ${key} is required`);
	return value;
}

export function parseGitHubRelease(value: unknown): GitHubRelease {
	const release = asRecord(value);
	if (release.draft !== false || release.prerelease !== false) {
		throw new Error("Only stable, published releases are supported");
	}
	const tag = requiredString(release, "tag_name");
	if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Release tag is not stable semver: ${tag}`);
	return {
		tag,
		name: typeof release.name === "string" && release.name.length > 0 ? release.name : tag,
		url: requiredString(release, "html_url"),
		publishedAt: requiredString(release, "published_at"),
	};
}

export function classifyRelease(state: MaintainerState, release: GitHubRelease) {
	return { release, lastSeenTag: state.lastSeenTag ?? null, isNew: state.lastSeenTag !== release.tag };
}

export function buildVerificationCommands(changedPaths: string[]): string[][] {
	const commands: string[][] = [
		["bun", "install", "--frozen-lockfile"],
		["bun", "check"],
		["bun", "scripts/prepare-maintenance-native.ts"],
		FORK_REGRESSION_COMMAND,
	];
	const forkRegressions = new Set(FORK_REGRESSION_COMMAND.slice(2));
	const changedTests = [...new Set(changedPaths)]
		.filter(changedPath => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(changedPath))
		.filter(changedPath => !forkRegressions.has(changedPath))
		.sort();
	if (changedTests.length > 0) commands.push(["bun", "test", ...changedTests]);
	return commands;
}

export function assertSubmittable(
	state: MaintainerState,
	headSha: string,
): asserts state is MaintainerState & {
	active: ActiveSync & { verifiedSha: string };
} {
	if (state.active?.status !== "verified" || !state.active.verifiedSha) {
		throw new Error("Active upstream sync is not verified");
	}
	if (state.active.verifiedSha !== headSha) {
		throw new Error("Active upstream sync changed after verification");
	}
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export function redactSecrets(value: string): string {
	return value
		.replace(/\b(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, "$1***:***@")
		.replace(/\b(https?:\/\/)([^/:@\s]+)@/gi, "$1***@")
		.replace(/([?&](?:access_token|auth|key|token)=)[^&\s]+/gi, "$1***");
}

export function renderLaunchAgent(options: LaunchAgentOptions): string {
	const args = [
		options.bunPath,
		options.scriptPath,
		"watch",
		"--once",
		"--repo",
		options.repoPath,
		"--state-dir",
		options.stateDir,
	];
	const renderedArgs = args.map(arg => `\t\t<string>${escapeXml(arg)}</string>`).join("\n");
	const logPath = escapeXml(path.join(options.stateDir, "watch.log"));
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>com.echopi.plaude-maintainer</string>
\t<key>ProgramArguments</key>
\t<array>
${renderedArgs}
\t</array>
\t<key>StartInterval</key>
\t<integer>${options.intervalSeconds}</integer>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${logPath}</string>
\t<key>StandardErrorPath</key>
\t<string>${logPath}</string>
</dict>
</plist>
`;
}

function isEnoent(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function loadState(stateDir: string): Promise<MaintainerState> {
	try {
		return (await Bun.file(path.join(stateDir, "state.json")).json()) as MaintainerState;
	} catch (error) {
		if (isEnoent(error)) return {};
		throw error;
	}
}

async function saveState(stateDir: string, state: MaintainerState): Promise<void> {
	await fs.mkdir(stateDir, { recursive: true });
	const target = path.join(stateDir, "state.json");
	const temporary = `${target}.${process.pid}.tmp`;
	await Bun.write(temporary, `${JSON.stringify(state, null, 2)}\n`);
	await fs.rename(temporary, target);
}

async function withLock<T>(stateDir: string, action: () => Promise<T>): Promise<T> {
	await fs.mkdir(stateDir, { recursive: true });
	const lockDir = path.join(stateDir, "lock");
	try {
		await fs.mkdir(lockDir);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			throw new Error(`Another plaude-maintain operation is active: ${lockDir}`);
		}
		throw error;
	}
	try {
		return await action();
	} finally {
		await fs.rm(lockDir, { recursive: true, force: true });
	}
}

function receiptStamp(): string {
	return new Date().toISOString().replaceAll(/[-:.]/g, "");
}

async function createReceipt(stateDir: string, status: string): Promise<string> {
	const receiptDir = path.join(stateDir, "receipts", `${receiptStamp()}-${status}`);
	await fs.mkdir(receiptDir, { recursive: true });
	return receiptDir;
}

async function appendCommandLog(logPath: string, argv: string[], result: CommandResult): Promise<void> {
	const section = [
		`$ ${redactSecrets(argv.join(" "))}`,
		redactSecrets(result.stdout),
		redactSecrets(result.stderr),
		`exit=${result.exitCode}`,
		"",
	].join("\n");
	await fs.appendFile(logPath, section);
}

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function runCommand(argv: string[], cwd: string, logPath?: string): Promise<CommandResult> {
	const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", env: Bun.env });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	const result = { stdout, stderr, exitCode };
	if (logPath) await appendCommandLog(logPath, argv, result);
	if (exitCode !== 0) throw new CommandError(argv, exitCode, stdout, stderr);
	return result;
}

async function git(cwd: string, args: string[], logPath?: string): Promise<string> {
	return (await runCommand(["git", ...args], cwd, logPath)).stdout.trim();
}

async function fetchLatestRelease(apiUrl: string): Promise<GitHubRelease> {
	const response = await fetch(apiUrl, {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "plaude-maintainer" },
	});
	if (!response.ok) throw new Error(`GitHub release request failed: ${response.status} ${response.statusText}`);
	return parseGitHubRelease(await response.json());
}

function print(value: unknown, json: boolean): void {
	if (json || typeof value !== "string") console.log(JSON.stringify(value, null, 2));
	else console.log(value);
}

async function checkRelease(options: CliOptions): Promise<void> {
	const state = await loadState(options.stateDir);
	print(classifyRelease(state, await fetchLatestRelease(options.releaseApiUrl)), options.json);
}

function appleScriptString(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function notifyRelease(release: GitHubRelease): Promise<void> {
	if (process.platform !== "darwin") return;
	const script = `display notification ${appleScriptString(release.url)} with title ${appleScriptString(
		`oh-my-pi ${release.tag} is available`,
	)}`;
	const child = Bun.spawn(["osascript", "-e", script], { stdout: "ignore", stderr: "ignore" });
	await child.exited;
}

async function watchOnce(options: CliOptions): Promise<void> {
	await withLock(options.stateDir, async () => {
		const state = await loadState(options.stateDir);
		const release = await fetchLatestRelease(options.releaseApiUrl);
		const result = classifyRelease(state, release);
		if (result.isNew) {
			await notifyRelease(release);
			state.lastSeenTag = release.tag;
			await saveState(options.stateDir, state);
		}
		print(result, options.json);
	});
}

async function installWatcher(options: CliOptions): Promise<void> {
	if (process.platform !== "darwin") throw new Error("watch --install currently supports macOS launchd only");
	await fs.mkdir(options.stateDir, { recursive: true });
	const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
	await fs.mkdir(launchAgentsDir, { recursive: true });
	const plistPath = path.join(launchAgentsDir, "com.echopi.plaude-maintainer.plist");
	await Bun.write(
		plistPath,
		renderLaunchAgent({
			bunPath: process.execPath,
			scriptPath: import.meta.path,
			repoPath: options.repoPath,
			stateDir: options.stateDir,
			intervalSeconds: options.intervalSeconds,
		}),
	);
	const domain = `gui/${process.getuid()}`;
	await runCommand(["launchctl", "bootout", domain, plistPath], options.repoPath).catch(() => undefined);
	await runCommand(["launchctl", "bootstrap", domain, plistPath], options.repoPath);
	print({ installed: true, plistPath, intervalSeconds: options.intervalSeconds }, options.json);
}

async function syncTag(options: CliOptions, tag: string): Promise<void> {
	if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Expected a stable release tag, got: ${tag}`);
	await withLock(options.stateDir, async () => {
		const state = await loadState(options.stateDir);
		if (state.active && state.active.status !== "submitted") {
			throw new Error(`Active sync already exists for ${state.active.tag} at ${state.active.worktree}`);
		}
		if ((await git(options.repoPath, ["status", "--porcelain"])) !== "") {
			throw new Error(`Repository is dirty: ${options.repoPath}`);
		}
		const receiptDir = await createReceipt(options.stateDir, "sync");
		const commandLog = path.join(receiptDir, "commands.log");
		await git(options.repoPath, ["fetch", options.forkRemote, options.workBranch], commandLog);
		await git(options.repoPath, ["fetch", options.upstreamUrl, `refs/tags/${tag}:refs/tags/${tag}`], commandLog);
		const baseRef = `refs/remotes/${options.forkRemote}/${options.workBranch}`;
		const baseSha = await git(options.repoPath, ["rev-parse", baseRef], commandLog);
		const branch = `maintain/${tag}`;
		const worktree = path.join(options.stateDir, "worktrees", tag);
		try {
			await fs.access(worktree);
			throw new Error(`Worktree path already exists: ${worktree}`);
		} catch (error) {
			if (!isEnoent(error)) throw error;
		}
		await fs.mkdir(path.dirname(worktree), { recursive: true });
		await git(options.repoPath, ["worktree", "add", "-b", branch, worktree, baseRef], commandLog);
		const active: ActiveSync = { tag, branch, worktree, baseSha, status: "prepared", receiptDir };
		state.active = active;
		try {
			await git(worktree, ["merge", "--no-edit", tag], commandLog);
		} catch (error) {
			active.status = "conflict";
			await saveState(options.stateDir, state);
			await Bun.write(path.join(receiptDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
			if (error instanceof CommandError) {
				throw new Error(`Merge conflict for ${tag}; resolve it in ${worktree}. Receipt: ${receiptDir}`);
			}
			throw error;
		}
		await saveState(options.stateDir, state);
		await Bun.write(path.join(receiptDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
		print(active, options.json);
	});
}

async function verifyActive(options: CliOptions): Promise<void> {
	await withLock(options.stateDir, async () => {
		const state = await loadState(options.stateDir);
		const active = state.active;
		if (!active) throw new Error("No active upstream sync");
		const unmerged = await git(active.worktree, ["diff", "--name-only", "--diff-filter=U"]);
		if (unmerged) throw new Error(`Unresolved merge conflicts:\n${unmerged}`);
		if ((await git(active.worktree, ["status", "--porcelain"])) !== "") {
			throw new Error("Commit conflict resolutions or fixes before verification");
		}
		const changedPaths = (await git(active.worktree, ["diff", "--name-only", `${active.baseSha}..HEAD`]))
			.split("\n")
			.filter(Boolean);
		const receiptDir = await createReceipt(options.stateDir, "verify");
		const commandLog = path.join(receiptDir, "commands.log");
		try {
			for (const command of buildVerificationCommands(changedPaths)) {
				await runCommand(command, active.worktree, commandLog);
			}
		} catch (error) {
			active.status = "verify-failed";
			active.receiptDir = receiptDir;
			delete active.verifiedSha;
			await saveState(options.stateDir, state);
			throw new Error(`Verification failed for ${active.tag}. Receipt: ${receiptDir}`, { cause: error });
		}
		active.status = "verified";
		active.verifiedSha = await git(active.worktree, ["rev-parse", "HEAD"], commandLog);
		active.receiptDir = receiptDir;
		await saveState(options.stateDir, state);
		await Bun.write(path.join(receiptDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
		print({ ...active, changedPaths, commands: buildVerificationCommands(changedPaths) }, options.json);
	});
}

async function submitActive(options: CliOptions): Promise<void> {
	await withLock(options.stateDir, async () => {
		const state = await loadState(options.stateDir);
		if (!state.active) throw new Error("No active upstream sync");
		const headSha = await git(state.active.worktree, ["rev-parse", "HEAD"]);
		assertSubmittable(state, headSha);
		const receiptDir = await createReceipt(options.stateDir, "submit");
		const commandLog = path.join(receiptDir, "commands.log");
		await git(
			state.active.worktree,
			["push", options.forkRemote, `HEAD:refs/heads/${options.workBranch}`],
			commandLog,
		);
		const currentBranch = await git(options.repoPath, ["branch", "--show-current"], commandLog);
		const localClean = (await git(options.repoPath, ["status", "--porcelain"], commandLog)) === "";
		const localUpdated = currentBranch === options.workBranch && localClean;
		if (localUpdated) await git(options.repoPath, ["merge", "--ff-only", headSha], commandLog);
		state.active.status = "submitted";
		state.active.submittedSha = headSha;
		state.active.receiptDir = receiptDir;
		state.lastSubmittedTag = state.active.tag;
		await saveState(options.stateDir, state);
		await Bun.write(path.join(receiptDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
		print({ ...state.active, localUpdated }, options.json);
	});
}

async function cleanupActive(options: CliOptions): Promise<void> {
	await withLock(options.stateDir, async () => {
		const state = await loadState(options.stateDir);
		const active = state.active;
		if (!active) return;
		if (active.status !== "submitted") throw new Error("Only a submitted sync can be cleaned up");
		await git(options.repoPath, ["worktree", "remove", active.worktree]);
		await git(options.repoPath, ["branch", "-d", active.branch]);
		delete state.active;
		await saveState(options.stateDir, state);
		print({ cleaned: true, tag: active.tag }, options.json);
	});
}

async function abandonActive(options: CliOptions): Promise<void> {
	await withLock(options.stateDir, async () => {
		const state = await loadState(options.stateDir);
		const active = state.active;
		if (!active) return;
		if (active.status === "submitted") throw new Error("Submitted syncs must be cleaned up, not abandoned");
		if ((await git(active.worktree, ["status", "--porcelain"])) !== "") {
			throw new Error("Commit or discard active worktree changes before abandoning it");
		}
		const receiptDir = await createReceipt(options.stateDir, "abandon");
		const commandLog = path.join(receiptDir, "commands.log");
		const abandonedSha = await git(active.worktree, ["rev-parse", "HEAD"], commandLog);
		await Bun.write(
			path.join(receiptDir, "abandoned.json"),
			`${JSON.stringify({ ...active, abandonedSha }, null, 2)}\n`,
		);
		await git(options.repoPath, ["worktree", "remove", active.worktree], commandLog);
		await git(options.repoPath, ["branch", "-D", active.branch], commandLog);
		delete state.active;
		await saveState(options.stateDir, state);
		print({ abandoned: true, tag: active.tag, abandonedSha, receiptDir }, options.json);
	});
}

function parsePositiveInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
	return parsed;
}

function parseArgs(argv: string[]): CliOptions {
	const command = argv[0] ?? "help";
	const positionals: string[] = [];
	const defaultStateHome = Bun.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
	const options: CliOptions = {
		command,
		positionals,
		repoPath: path.resolve(Bun.env.PLAUDE_REPO_DIR ?? process.cwd()),
		stateDir: path.join(defaultStateHome, "plaude-maintainer"),
		upstreamUrl: Bun.env.PLAUDE_UPSTREAM_URL ?? "https://github.com/can1357/oh-my-pi.git",
		forkRemote: Bun.env.PLAUDE_FORK_REMOTE ?? "origin",
		workBranch: Bun.env.PLAUDE_WORK_BRANCH ?? "auto/upstream-sync",
		releaseApiUrl: Bun.env.PLAUDE_RELEASE_API_URL ?? "https://api.github.com/repos/can1357/oh-my-pi/releases/latest",
		intervalSeconds: 1800,
		once: false,
		install: false,
		json: false,
	};
	for (let index = 1; index < argv.length; index++) {
		const arg = argv[index];
		switch (arg) {
			case "--repo":
				options.repoPath = path.resolve(argv[++index] ?? "");
				break;
			case "--state-dir":
				options.stateDir = path.resolve(argv[++index] ?? "");
				break;
			case "--upstream-url":
				options.upstreamUrl = argv[++index] ?? "";
				break;
			case "--fork-remote":
				options.forkRemote = argv[++index] ?? "";
				break;
			case "--work-branch":
				options.workBranch = argv[++index] ?? "";
				break;
			case "--release-api-url":
				options.releaseApiUrl = argv[++index] ?? "";
				break;
			case "--interval":
				options.intervalSeconds = parsePositiveInteger(argv[++index] ?? "", "--interval");
				break;
			case "--once":
				options.once = true;
				break;
			case "--install":
				options.install = true;
				break;
			case "--json":
				options.json = true;
				break;
			default:
				if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
				positionals.push(arg);
		}
	}
	return options;
}

function usage(): string {
	return `plaude-maintain — maintain the Plaude fork against oh-my-pi releases

Usage:
  bun scripts/plaude-maintain.ts status [--json]
  bun scripts/plaude-maintain.ts check-release [--json]
  bun scripts/plaude-maintain.ts watch --once [--json]
  bun scripts/plaude-maintain.ts watch --install [--interval 1800]
  bun scripts/plaude-maintain.ts sync <vX.Y.Z> [--json]
  bun scripts/plaude-maintain.ts verify [--json]
  bun scripts/plaude-maintain.ts submit [--json]
  bun scripts/plaude-maintain.ts cleanup [--json]
  bun scripts/plaude-maintain.ts abandon [--json]

Common options: --repo, --state-dir, --upstream-url, --fork-remote, --work-branch
`;
}

async function main(argv: string[]): Promise<void> {
	const options = parseArgs(argv);
	switch (options.command) {
		case "status":
			print(await loadState(options.stateDir), options.json);
			break;
		case "check-release":
			await checkRelease(options);
			break;
		case "watch":
			if (options.install) await installWatcher(options);
			else if (options.once) await watchOnce(options);
			else throw new Error("watch requires --once or --install");
			break;
		case "sync":
			await syncTag(options, options.positionals[0] ?? "");
			break;
		case "verify":
			await verifyActive(options);
			break;
		case "submit":
			await submitActive(options);
			break;
		case "cleanup":
			await cleanupActive(options);
			break;
		case "abandon":
			await abandonActive(options);
			break;
		case "help":
		case "--help":
		case "-h":
			console.log(usage());
			break;
		default:
			throw new Error(`Unknown command: ${options.command}\n\n${usage()}`);
	}
}

if (import.meta.main) {
	main(Bun.argv.slice(2)).catch(error => {
		if (error instanceof CommandError) {
			if (error.stdout) process.stderr.write(redactSecrets(error.stdout));
			if (error.stderr) process.stderr.write(redactSecrets(error.stderr));
		}
		console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
	});
}
