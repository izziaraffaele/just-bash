/**
 * README and AGENTS.md validation tests
 *
 * Ensures documentation stays in sync with the actual codebase:
 * 1. Command list is complete and accurate
 * 2. TypeScript examples compile correctly
 * 3. Bash examples execute correctly
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import {
  getCommandNames,
  getNetworkCommandNames,
} from "./commands/registry.js";

const README_PATH = path.join(import.meta.dirname, "..", "README.md");
const AGENTS_PATH = path.join(import.meta.dirname, "..", "AGENTS.npm.md");

function parseReadme(): string {
  return fs.readFileSync(README_PATH, "utf-8");
}

function parseAgents(): string {
  return fs.readFileSync(AGENTS_PATH, "utf-8");
}

/**
 * Extract bash code blocks from markdown
 */
function extractBashBlocks(content: string): string[] {
  const blocks: string[] = [];
  const pattern = /```bash\n([\s\S]*?)```/g;

  for (const match of content.matchAll(pattern)) {
    blocks.push(match[1]);
  }

  return blocks;
}

/**
 * Extract command names from README "Supported Commands" section
 */
function extractReadmeCommands(readme: string): Set<string> {
  const commands = new Set<string>();

  // Find the "Supported Commands" section (stop at "All commands support")
  const supportedMatch = readme.match(
    /## Supported Commands\n([\s\S]*?)(?=\nAll commands support|\n## [A-Z]|\n---|\$)/,
  );
  if (!supportedMatch) {
    throw new Error("Could not find 'Supported Commands' section in README");
  }

  const section = supportedMatch[1];

  // Extract all backtick-quoted command names
  // Matches: `cmd`, `cmd` (+ `alias1`, `alias2`)
  const cmdPattern = /`([a-z0-9_-]+)`/g;
  for (const match of section.matchAll(cmdPattern)) {
    commands.add(match[1]);
  }

  return commands;
}

/**
 * Extract TypeScript code blocks from README
 */
function extractTypeScriptBlocks(readme: string): string[] {
  const blocks: string[] = [];
  const pattern = /```typescript\n([\s\S]*?)```/g;

  for (const match of readme.matchAll(pattern)) {
    blocks.push(match[1]);
  }

  return blocks;
}

/**
 * Rename duplicate const/let declarations to avoid redeclaration errors
 * e.g., if "const env" appears twice, the second becomes "const env_2"
 */
function renameDuplicateDeclarations(code: string): string {
  const varCounts = new Map<string, number>();
  // Match const/let declarations like "const env =" or "const env="
  return code.replace(
    /\b(const|let)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g,
    (match, keyword, varName) => {
      const count = (varCounts.get(varName) || 0) + 1;
      varCounts.set(varName, count);
      if (count > 1) {
        return `${keyword} ${varName}_${count} =`;
      }
      return match;
    },
  );
}

/**
 * Add implied imports to a code block and wrap non-import code in async IIFE
 * to avoid redeclaration errors between examples
 */
function addImpliedImports(code: string): string {
  const imports: string[] = [];

  // Check what's used and add appropriate imports
  if (code.includes("Bash") && !code.includes('from "just-bash"')) {
    imports.push('import { Bash } from "just-bash";');
  }
  if (code.includes("defineCommand") && !code.includes('from "just-bash"')) {
    imports.push('import { defineCommand } from "just-bash";');
  }
  if (code.includes("Sandbox") && !code.includes('from "just-bash"')) {
    imports.push('import { Sandbox } from "just-bash";');
  }
  if (
    code.includes("createBashTool") &&
    !code.includes('from "just-bash/ai"')
  ) {
    imports.push('import { createBashTool } from "just-bash/ai";');
  }
  if (
    code.includes("OverlayFs") &&
    !code.includes('from "just-bash/fs/overlay-fs"')
  ) {
    imports.push('import { OverlayFs } from "just-bash/fs/overlay-fs";');
  }
  if (
    code.includes("ReadWriteFs") &&
    !code.includes('from "just-bash/fs/read-write-fs"')
  ) {
    imports.push('import { ReadWriteFs } from "just-bash/fs/read-write-fs";');
  }
  if (code.includes("generateText") && !code.includes('from "ai"')) {
    imports.push('import { generateText } from "ai";');
  }

  // Extract existing imports from code
  const existingImports = code.match(/^import .*/gm) || [];
  const codeWithoutImports = code.replace(/^import .*\n?/gm, "").trim();

  // Filter out imports that are already present
  const newImports = imports.filter(
    (imp) => !existingImports.some((existing) => existing.includes(imp)),
  );

  // Combine all imports
  const allImports = [...existingImports, ...newImports];

  // Rename duplicate variable declarations to avoid redeclaration errors
  const scopedCode = renameDuplicateDeclarations(codeWithoutImports);

  // Wrap non-import code in async IIFE to create separate scope
  const wrappedCode = `(async () => {\n${scopedCode}\n})();`;

  if (allImports.length === 0) {
    return wrappedCode;
  }

  return `${allImports.join("\n")}\n\n${wrappedCode}`;
}

describe("README validation", () => {
  describe("command list completeness", () => {
    it("should list all registered commands", () => {
      const readme = parseReadme();
      const readmeCommands = extractReadmeCommands(readme);
      const registryCommands = new Set([
        ...getCommandNames(),
        ...getNetworkCommandNames(),
      ]);

      // Commands in registry but not in README
      const missingFromReadme: string[] = [];
      for (const cmd of registryCommands) {
        if (!readmeCommands.has(cmd)) {
          missingFromReadme.push(cmd);
        }
      }

      // Commands in README but not in registry
      const extraInReadme: string[] = [];
      for (const cmd of readmeCommands) {
        if (!registryCommands.has(cmd)) {
          extraInReadme.push(cmd);
        }
      }

      // Check for missing commands (not in README)
      if (missingFromReadme.length > 0) {
        expect.fail(
          `Commands missing from README: ${missingFromReadme.join(", ")}\n` +
            "Add these to the 'Supported Commands' section in README.md",
        );
      }

      // Check for extra commands (in README but not registered)
      // Filter out known aliases and special cases
      const knownExtras = new Set([
        "cd", // builtin, not a command
        "export", // builtin, not a command
      ]);
      const realExtras = extraInReadme.filter((cmd) => !knownExtras.has(cmd));

      if (realExtras.length > 0) {
        expect.fail(
          `Commands in README but not in registry: ${realExtras.join(", ")}\n` +
            "Either add these to the registry or remove from README.md",
        );
      }
    });

    it("should have a reasonable number of commands", () => {
      const readme = parseReadme();
      const readmeCommands = extractReadmeCommands(readme);

      // Sanity check - we should have a good number of commands
      expect(readmeCommands.size).toBeGreaterThan(40);
      expect(readmeCommands.size).toBeLessThan(150);
    });
  });

  describe("TypeScript examples", () => {
    it("should have TypeScript code blocks", () => {
      const readme = parseReadme();
      const blocks = extractTypeScriptBlocks(readme);

      // README should have several TypeScript examples
      expect(blocks.length).toBeGreaterThan(5);
    });

    it(
      "should have valid TypeScript syntax in all examples",
      { timeout: 30000 },
      () => {
        const readme = parseReadme();
        const blocks = extractTypeScriptBlocks(readme);

        // Create a temp directory for type checking
        const tmpDir = path.join(import.meta.dirname, "..", ".readme-test-tmp");
        fs.mkdirSync(tmpDir, { recursive: true });

        try {
          // Write all blocks to files
          const files: string[] = [];
          for (let i = 0; i < blocks.length; i++) {
            const code = addImpliedImports(blocks[i]);
            const filePath = path.join(tmpDir, `example-${i}.ts`);
            fs.writeFileSync(filePath, code);
            files.push(filePath);
          }

          // Create a tsconfig for type checking
          const tsconfig = {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              skipLibCheck: true,
              noEmit: true,
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
              resolveJsonModule: true,
              paths: {
                "just-bash": [
                  path.join(import.meta.dirname, "..", "src/index.ts"),
                ],
                "just-bash/ai": [
                  path.join(import.meta.dirname, "..", "src/ai/index.ts"),
                ],
                "just-bash/fs/overlay-fs": [
                  path.join(
                    import.meta.dirname,
                    "..",
                    "src/fs/overlay-fs/index.ts",
                  ),
                ],
                "just-bash/fs/read-write-fs": [
                  path.join(
                    import.meta.dirname,
                    "..",
                    "src/fs/read-write-fs/index.ts",
                  ),
                ],
              },
            },
            include: files,
          };
          fs.writeFileSync(
            path.join(tmpDir, "tsconfig.json"),
            JSON.stringify(tsconfig, null, 2),
          );

          // Run tsc to check types
          try {
            execSync("npx tsc --project tsconfig.json", {
              cwd: tmpDir,
              encoding: "utf-8",
              stdio: "pipe",
            });
          } catch (error) {
            const execError = error as { stdout?: string; stderr?: string };
            const output = execError.stdout || execError.stderr || "";

            // Parse errors to show which example failed
            const errorLines = output
              .split("\n")
              .filter((line) => line.includes("error TS"));

            if (errorLines.length > 0) {
              expect.fail(
                `TypeScript errors in README examples:\n${errorLines.slice(0, 10).join("\n")}` +
                  (errorLines.length > 10
                    ? `\n... and ${errorLines.length - 10} more`
                    : ""),
              );
            }
          }
        } finally {
          // Cleanup
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    );
  });
});

describe("AGENTS.npm.md validation", () => {
  describe("TypeScript examples", () => {
    it("should have TypeScript code blocks", () => {
      const agents = parseAgents();
      const blocks = extractTypeScriptBlocks(agents);

      // AGENTS.md should have at least one TypeScript example
      expect(blocks.length).toBeGreaterThan(0);
    });

    it(
      "should have valid TypeScript syntax in all examples",
      { timeout: 30000 },
      () => {
        const agents = parseAgents();
        const blocks = extractTypeScriptBlocks(agents);

        if (blocks.length === 0) return;

        // Create a temp directory for type checking
        const tmpDir = path.join(import.meta.dirname, "..", ".agents-test-tmp");
        fs.mkdirSync(tmpDir, { recursive: true });

        try {
          // Write all blocks to files
          const files: string[] = [];
          for (let i = 0; i < blocks.length; i++) {
            const code = addImpliedImports(blocks[i]);
            const filePath = path.join(tmpDir, `example-${i}.ts`);
            fs.writeFileSync(filePath, code);
            files.push(filePath);
          }

          // Create a tsconfig for type checking
          const tsconfig = {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              skipLibCheck: true,
              noEmit: true,
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
              resolveJsonModule: true,
              paths: {
                "just-bash": [
                  path.join(import.meta.dirname, "..", "src/index.ts"),
                ],
                "just-bash/ai": [
                  path.join(import.meta.dirname, "..", "src/ai/index.ts"),
                ],
                "just-bash/fs/overlay-fs": [
                  path.join(
                    import.meta.dirname,
                    "..",
                    "src/fs/overlay-fs/index.ts",
                  ),
                ],
                "just-bash/fs/read-write-fs": [
                  path.join(
                    import.meta.dirname,
                    "..",
                    "src/fs/read-write-fs/index.ts",
                  ),
                ],
              },
            },
            include: files,
          };
          fs.writeFileSync(
            path.join(tmpDir, "tsconfig.json"),
            JSON.stringify(tsconfig, null, 2),
          );

          // Run tsc to check types
          try {
            execSync("npx tsc --project tsconfig.json", {
              cwd: tmpDir,
              encoding: "utf-8",
              stdio: "pipe",
            });
          } catch (error) {
            const execError = error as { stdout?: string; stderr?: string };
            const output = execError.stdout || execError.stderr || "";

            // Parse errors to show which example failed
            const errorLines = output
              .split("\n")
              .filter((line) => line.includes("error TS"));

            if (errorLines.length > 0) {
              expect.fail(
                `TypeScript errors in AGENTS.npm.md examples:\n${errorLines.slice(0, 10).join("\n")}` +
                  (errorLines.length > 10
                    ? `\n... and ${errorLines.length - 10} more`
                    : ""),
              );
            }
          }
        } finally {
          // Cleanup
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    );
  });

  describe("Bash examples", () => {
    it("should have bash code blocks", () => {
      const agents = parseAgents();
      const blocks = extractBashBlocks(agents);

      // AGENTS.md should have bash examples
      expect(blocks.length).toBeGreaterThan(0);
    });

    it("should execute bash examples without errors", async () => {
      const agents = parseAgents();
      const blocks = extractBashBlocks(agents);

      // Set up a bash environment with sample data for the examples
      const bash = new Bash({
        files: {
          "/data/input.txt": "hello world\ntest pattern\nfoo bar\n",
          "/data/data.json":
            '{"items": [{"name": "a", "active": true}, {"name": "b", "active": false}]}',
          "/data/data.csv": "name,category,value\nalice,A,10\nbob,B,20\n",
          "/src/app.ts": "// TODO: implement\nexport const x = 1;",
          "/src/lib.ts": "// helper\nexport const y = 2;",
        },
        cwd: "/data",
      });

      for (const block of blocks) {
        // Extract individual commands from the block
        const commands = block
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));

        for (const cmd of commands) {
          // Skip commands that are just comments or empty
          if (!cmd || cmd.startsWith("#")) continue;

          const result = await bash.exec(cmd);

          // Commands should not have stderr (warnings/errors)
          // Allow exitCode 1 for grep (no matches) but fail on other errors
          if (result.exitCode !== 0 && result.exitCode !== 1) {
            expect.fail(
              `Bash command failed in AGENTS.npm.md:\n` +
                `Command: ${cmd}\n` +
                `Exit code: ${result.exitCode}\n` +
                `Stderr: ${result.stderr}`,
            );
          }
        }
      }
    });
  });
});
