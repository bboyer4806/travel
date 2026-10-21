// PreToolUse hook for Read: blocks whole-file reads of large files so the agent
// greps for what it needs and reads that range instead.
import { readFileSync, statSync } from 'node:fs';

const MAX_BYTES = 40_000;

const { tool_input: input } = JSON.parse(readFileSync(0, 'utf8'));
if (input.limit !== undefined) process.exit(0);

const bytes = statSync(input.file_path, { throwIfNoEntry: false })?.size ?? 0;
if (bytes <= MAX_BYTES) process.exit(0);

console.error(
	`${input.file_path} is ${Math.round(bytes / 1000)} KB. Grep for the section or symbol you need, ` +
		`then Read with offset and limit.`
);
process.exit(2);
