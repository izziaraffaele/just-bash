# bash-env

A simulated bash environment with an in-memory (pluggable) virtual filesystem, written in TypeScript.

Designed for agents exploring a filesystem with a "full" but secure bash tool.

## Installation

```bash
pnpm install
```

## Usage

### Programmatic API

```typescript
import { BashEnv } from "./src/BashEnv.js";

// Default layout: starts in /home/user with /bin, /tmp
const env = new BashEnv();
await env.exec('echo "Hello" > greeting.txt');
const result = await env.exec("cat greeting.txt");
console.log(result.stdout); // "Hello\n"

// Custom files: starts in / with only specified files
const custom = new BashEnv({
  files: { "/data/file.txt": "content" },
});
await custom.exec("cat /data/file.txt");

// With custom execution limits
const limited = new BashEnv({
  maxCallDepth: 50, // Max recursion depth (default: 100)
  maxLoopIterations: 5000, // Max loop iterations (default: 10000)
});
```

### Vercel Sandbox Compatible API

BashEnv provides a `Sandbox` class that's API-compatible with [`@vercel/sandbox`](https://vercel.com/docs/vercel-sandbox), making it easy to swap implementations. You can start with BashEnv and switch to a real sandbox when you are ready.

```typescript
import { Sandbox } from "bash-env";

// Create a sandbox instance
const sandbox = await Sandbox.create({ cwd: "/app" });

// Write files to the virtual filesystem
await sandbox.writeFiles({
  "/app/script.sh": 'echo "Hello World"',
  "/app/data.json": '{"key": "value"}',
});

// Run commands and get results
const cmd = await sandbox.runCommand("bash /app/script.sh");
const output = await cmd.stdout(); // "Hello World\n"
const exitCode = (await cmd.wait()).exitCode; // 0

// Read files back
const content = await sandbox.readFile("/app/data.json");

// Create directories
await sandbox.mkDir("/app/logs", { recursive: true });

// Clean up (no-op for BashEnv, but API-compatible)
await sandbox.stop();
```

#### Command Streaming

The `Command` class provides multiple ways to access output:

```typescript
const cmd = await sandbox.runCommand("echo hello; echo world >&2");

// Get stdout/stderr separately
const stdout = await cmd.stdout(); // "hello\n"
const stderr = await cmd.stderr(); // "world\n"

// Get combined output
const output = await cmd.output(); // "hello\nworld\n"

// Stream logs as they arrive
for await (const msg of cmd.logs()) {
  console.log(msg.type, msg.data); // "stdout" "hello\n", "stderr" "world\n"
}

// Wait for completion
const finished = await cmd.wait();
console.log(finished.exitCode); // 0
```

### Interactive Shell

```bash
pnpm shell
```

## Supported Commands

### File Operations

`cat`, `cp`, `ln`, `ls`, `mkdir`, `mv`, `readlink`, `rm`, `stat`, `touch`, `tree`

### Text Processing

`awk`, `cut`, `grep`, `head`, `printf`, `sed`, `sort`, `tail`, `tr`, `uniq`, `wc`, `xargs`

### Navigation & Environment

`basename`, `cd`, `dirname`, `du`, `echo`, `env`, `export`, `find`, `printenv`, `pwd`, `tee`

### Shell Utilities

`alias`, `bash`, `chmod`, `clear`, `false`, `history`, `sh`, `true`, `unalias`

All commands support `--help` for usage information.

## Shell Features

- **Pipes**: `cmd1 | cmd2`
- **Redirections**: `>`, `>>`, `2>`, `2>&1`, `<`
- **Command chaining**: `&&`, `||`, `;`
- **Variables**: `$VAR`, `${VAR}`, `${VAR:-default}`
- **Positional parameters**: `$1`, `$2`, `$@`, `$#`
- **Glob patterns**: `*`, `?`, `[...]`
- **If statements**: `if COND; then CMD; elif COND; then CMD; else CMD; fi`
- **Functions**: `function name { ... }` or `name() { ... }`
- **Local variables**: `local VAR=value`
- **Loops**: `for`, `while`, `until`
- **Symbolic links**: `ln -s target link`
- **Hard links**: `ln target link`

## Default Layout

When created without options, BashEnv provides a Unix-like directory structure:

- `/home/user` - Default working directory (and `$HOME`)
- `/bin` - Contains stubs for all built-in commands
- `/usr/bin` - Additional binary directory
- `/tmp` - Temporary files directory

Commands can be invoked by path (e.g., `/bin/ls`) or by name.

## Execution Protection

BashEnv includes protection against infinite loops and deep recursion:

- **Max call depth**: Limits function recursion (default: 100)
- **Max loop iterations**: Limits for/while/until loops (default: 10000)

These can be configured via constructor options. Error messages include hints on how to increase limits if needed.

## Development

```bash
pnpm test        # Run tests in watch mode
pnpm test:run    # Run tests once
pnpm typecheck   # Type check without emitting
pnpm build       # Build TypeScript
pnpm shell       # Run interactive shell
```

## License

ISC
