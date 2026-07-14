#!/usr/bin/env bun

import * as path from "node:path";
import { $ } from "bun";

const repoRoot = path.join(import.meta.dir, "..");
const platformTag = `${process.platform}-${process.arch}`;

if (Bun.which("cargo")) {
	await $`bun run build:native`.cwd(repoRoot);
} else {
	const supportedPlatforms = new Set(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]);
	if (!supportedPlatforms.has(platformTag)) {
		throw new Error(`No published pi-natives package for ${platformTag}; install Cargo to build the addon locally.`);
	}
	const manifest = (await Bun.file(path.join(repoRoot, "packages/natives/package.json")).json()) as {
		version?: unknown;
	};
	if (typeof manifest.version !== "string" || manifest.version.length === 0) {
		throw new Error("packages/natives/package.json must contain a version");
	}
	const packageSpec = `@oh-my-pi/pi-natives-${platformTag}@${manifest.version}`;
	await $`bun add --no-save --minimum-release-age=0 --registry=https://registry.npmjs.org ${packageSpec}`.cwd(
		repoRoot,
	);
}
