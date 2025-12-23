import { VirtualFs, IFileSystem } from './fs.js';
import { Command, CommandContext, CommandRegistry, ExecResult } from './types.js';
import { ShellParser, Pipeline, Redirection } from './shell/index.js';
import { GlobExpander } from './shell/index.js';

// Import commands
import { echoCommand } from './commands/echo/echo.js';
import { catCommand } from './commands/cat/cat.js';
import { lsCommand } from './commands/ls/ls.js';
import { mkdirCommand } from './commands/mkdir/mkdir.js';
import { pwdCommand } from './commands/pwd/pwd.js';
import { touchCommand } from './commands/touch/touch.js';
import { rmCommand } from './commands/rm/rm.js';
import { cpCommand } from './commands/cp/cp.js';
import { mvCommand } from './commands/mv/mv.js';
import { headCommand } from './commands/head/head.js';
import { tailCommand } from './commands/tail/tail.js';
import { wcCommand } from './commands/wc/wc.js';
import { grepCommand } from './commands/grep/grep.js';
import { sortCommand } from './commands/sort/sort.js';
import { uniqCommand } from './commands/uniq/uniq.js';
import { findCommand } from './commands/find/find.js';
import { sedCommand } from './commands/sed/sed.js';
import { cutCommand } from './commands/cut/cut.js';
import { trCommand } from './commands/tr/tr.js';
import { trueCommand, falseCommand } from './commands/true/true.js';
import { basenameCommand } from './commands/basename/basename.js';
import { dirnameCommand } from './commands/dirname/dirname.js';
import { teeCommand } from './commands/tee/tee.js';
import { xargsCommand } from './commands/xargs/xargs.js';
import { envCommand, printenvCommand } from './commands/env/env.js';

export interface BashEnvOptions {
  /**
   * Initial files to populate the virtual filesystem.
   * Only used when fs is not provided.
   */
  files?: Record<string, string>;
  /**
   * Environment variables
   */
  env?: Record<string, string>;
  /**
   * Initial working directory
   */
  cwd?: string;
  /**
   * Custom filesystem implementation.
   * If provided, 'files' option is ignored.
   * Defaults to VirtualFs if not provided.
   */
  fs?: IFileSystem;
}

export class BashEnv {
  private fs: IFileSystem;
  private cwd: string;
  private env: Record<string, string>;
  private commands: CommandRegistry = new Map();
  private functions: Map<string, string> = new Map();
  private previousDir: string = '/home/user';
  private parser: ShellParser;
  private useDefaultLayout: boolean = false;
  // Stack of local variable scopes for function calls
  private localScopes: Map<string, string | undefined>[] = [];

  constructor(options: BashEnvOptions = {}) {
    // Use provided filesystem or create a new VirtualFs
    const fs = options.fs ?? new VirtualFs(options.files);
    this.fs = fs;

    // Use /home/user as default cwd only if no cwd specified
    this.useDefaultLayout = !options.cwd && !options.files;
    this.cwd = options.cwd || (this.useDefaultLayout ? '/home/user' : '/');
    this.env = {
      HOME: this.useDefaultLayout ? '/home/user' : '/',
      PATH: '/bin:/usr/bin',
      ...options.env
    };
    this.parser = new ShellParser(this.env);

    // Create essential directories for VirtualFs (only for default layout)
    if (fs instanceof VirtualFs && this.useDefaultLayout) {
      try {
        fs.mkdirSync('/home/user', { recursive: true });
        fs.mkdirSync('/bin', { recursive: true });
        fs.mkdirSync('/usr/bin', { recursive: true });
        fs.mkdirSync('/tmp', { recursive: true });
      } catch {
        // Ignore errors - directories may already exist
      }
    }

    // Ensure cwd exists in the virtual filesystem
    if (this.cwd !== '/' && fs instanceof VirtualFs) {
      try {
        fs.mkdirSync(this.cwd, { recursive: true });
      } catch {
        // Ignore errors - the directory may already exist
      }
    }

    // Register built-in commands
    this.registerCommand(echoCommand);
    this.registerCommand(catCommand);
    this.registerCommand(lsCommand);
    this.registerCommand(mkdirCommand);
    this.registerCommand(pwdCommand);
    this.registerCommand(touchCommand);
    this.registerCommand(rmCommand);
    this.registerCommand(cpCommand);
    this.registerCommand(mvCommand);
    this.registerCommand(headCommand);
    this.registerCommand(tailCommand);
    this.registerCommand(wcCommand);
    this.registerCommand(grepCommand);
    this.registerCommand(sortCommand);
    this.registerCommand(uniqCommand);
    this.registerCommand(findCommand);
    this.registerCommand(sedCommand);
    this.registerCommand(cutCommand);
    this.registerCommand(trCommand);
    this.registerCommand(trueCommand);
    this.registerCommand(falseCommand);
    this.registerCommand(basenameCommand);
    this.registerCommand(dirnameCommand);
    this.registerCommand(teeCommand);
    this.registerCommand(xargsCommand);
    this.registerCommand(envCommand);
    this.registerCommand(printenvCommand);
  }

  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
    // Create executable stub in /bin for VirtualFs (only for default layout)
    if (this.fs instanceof VirtualFs && this.useDefaultLayout) {
      try {
        // Create a stub executable file in /bin
        this.fs.writeFileSync(`/bin/${command.name}`, `#!/bin/bash\n# Built-in command: ${command.name}\n`);
      } catch {
        // Ignore errors
      }
    }
  }

  async exec(commandLine: string): Promise<ExecResult> {
    // Handle empty command
    if (!commandLine.trim()) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    // Check for if statements
    const trimmed = commandLine.trim();
    if (trimmed.startsWith('if ') || trimmed.startsWith('if;') || trimmed === 'if') {
      return this.executeIfStatement(trimmed);
    }

    // Check for function definitions
    const funcDef = this.parseFunctionDefinition(trimmed);
    if (funcDef) {
      this.functions.set(funcDef.name, funcDef.body);
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    // Update parser with current environment
    this.parser.setEnv(this.env);

    // Parse the command line into pipelines
    const pipelines = this.parser.parse(commandLine);

    let stdin = '';
    let lastResult: ExecResult = { stdout: '', stderr: '', exitCode: 0 };

    // Execute each pipeline
    for (const pipeline of pipelines) {
      const result = await this.executePipeline(pipeline, stdin);
      stdin = result.stdout;
      lastResult = result;
    }

    return lastResult;
  }

  /**
   * Parse and execute an if statement
   * Syntax: if CONDITION; then COMMANDS; [elif CONDITION; then COMMANDS;]... [else COMMANDS;] fi
   */
  private async executeIfStatement(input: string): Promise<ExecResult> {
    // Parse the if statement structure
    const parsed = this.parseIfStatement(input);
    if (parsed.error) {
      return { stdout: '', stderr: parsed.error, exitCode: 2 };
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    // Evaluate conditions in order
    for (const branch of parsed.branches) {
      if (branch.condition === null) {
        // This is the else branch - execute it
        const result = await this.exec(branch.body);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
        break;
      }

      // Evaluate the condition
      const condResult = await this.exec(branch.condition);
      if (condResult.exitCode === 0) {
        // Condition is true, execute the body
        const result = await this.exec(branch.body);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
        break;
      }
    }

    return { stdout, stderr, exitCode };
  }

  /**
   * Parse if statement into structured form
   */
  private parseIfStatement(input: string): { branches: { condition: string | null; body: string }[]; error?: string } {
    const branches: { condition: string | null; body: string }[] = [];

    // Tokenize preserving structure
    let rest = input.trim();

    // Must start with 'if'
    if (!rest.startsWith('if ') && !rest.startsWith('if;')) {
      return { branches: [], error: 'bash: syntax error near unexpected token\n' };
    }
    rest = rest.slice(2).trim();

    // Parse: CONDITION; then BODY [elif CONDITION; then BODY]* [else BODY] fi
    let depth = 1;
    let pos = 0;
    let state: 'condition' | 'body' = 'condition';
    let currentCondition = '';
    let currentBody = '';

    while (pos < rest.length && depth > 0) {
      // Check for nested if
      if (rest.slice(pos).match(/^if\s/)) {
        if (state === 'condition') {
          currentCondition += 'if ';
        } else {
          currentBody += 'if ';
        }
        pos += 3;
        depth++;
        continue;
      }

      // Check for fi
      if (rest.slice(pos).match(/^fi(\s|;|$)/)) {
        depth--;
        if (depth === 0) {
          // End of our if statement
          if (state === 'body') {
            branches.push({ condition: currentCondition.trim() || null, body: currentBody.trim() });
          }
          break;
        } else {
          if (state === 'condition') {
            currentCondition += 'fi';
          } else {
            currentBody += 'fi';
          }
          pos += 2;
          continue;
        }
      }

      // Check for 'then' (only at depth 1)
      if (depth === 1 && rest.slice(pos).match(/^then(\s|;|$)/)) {
        state = 'body';
        pos += 4;
        // Skip semicolon/whitespace
        while (pos < rest.length && (rest[pos] === ';' || rest[pos] === ' ')) pos++;
        continue;
      }

      // Check for 'elif' (only at depth 1)
      if (depth === 1 && rest.slice(pos).match(/^elif\s/)) {
        // Save current branch
        if (currentCondition.trim() || currentBody.trim()) {
          branches.push({ condition: currentCondition.trim(), body: currentBody.trim() });
        }
        currentCondition = '';
        currentBody = '';
        state = 'condition';
        pos += 5;
        continue;
      }

      // Check for 'else' (only at depth 1)
      if (depth === 1 && rest.slice(pos).match(/^else(\s|;|$)/)) {
        // Save current branch
        if (currentCondition.trim() || currentBody.trim()) {
          branches.push({ condition: currentCondition.trim(), body: currentBody.trim() });
        }
        currentCondition = '';
        currentBody = '';
        // else has no condition
        state = 'body';
        pos += 4;
        // Skip semicolon/whitespace
        while (pos < rest.length && (rest[pos] === ';' || rest[pos] === ' ')) pos++;
        // Mark this as else branch (no condition)
        currentCondition = '';
        continue;
      }

      // Regular character
      if (state === 'condition') {
        // Handle semicolon before 'then'
        if (rest[pos] === ';') {
          pos++;
          // Skip whitespace
          while (pos < rest.length && rest[pos] === ' ') pos++;
          continue;
        }
        currentCondition += rest[pos];
      } else {
        currentBody += rest[pos];
      }
      pos++;
    }

    // Handle 'else' branch specially
    if (branches.length > 0 && branches[branches.length - 1].condition === '') {
      branches[branches.length - 1].condition = null;
    }

    if (depth !== 0) {
      return { branches: [], error: 'bash: syntax error: unexpected end of file\n' };
    }

    if (branches.length === 0) {
      return { branches: [], error: 'bash: syntax error near unexpected token\n' };
    }

    return { branches };
  }

  /**
   * Parse a function definition
   * Syntax: function name { commands; } or name() { commands; }
   */
  private parseFunctionDefinition(input: string): { name: string; body: string } | null {
    // Match: function name { ... }
    const funcKeywordMatch = input.match(/^function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{(.*)\}\s*$/s);
    if (funcKeywordMatch) {
      return { name: funcKeywordMatch[1], body: funcKeywordMatch[2].trim() };
    }

    // Match: name() { ... }
    const parenMatch = input.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\)\s*\{(.*)\}\s*$/s);
    if (parenMatch) {
      return { name: parenMatch[1], body: parenMatch[2].trim() };
    }

    return null;
  }

  private async executePipeline(pipeline: Pipeline, initialStdin: string): Promise<ExecResult> {
    let stdin = initialStdin;
    let lastResult: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
    let accumulatedStdout = '';
    let accumulatedStderr = '';

    for (let i = 0; i < pipeline.commands.length; i++) {
      const { parsed, operator } = pipeline.commands[i];
      const nextCommand = pipeline.commands[i + 1];
      const nextOperator = nextCommand?.operator || '';

      // Check if we should run based on previous result (for &&, ||, ;)
      if (operator === '&&' && lastResult.exitCode !== 0) continue;
      if (operator === '||' && lastResult.exitCode === 0) continue;
      // For ';', always run

      // Determine if previous command was a pipe (empty operator means pipe)
      const isPipedInput = operator === '';
      // Determine if next command is a pipe
      const isPipedOutput = nextOperator === '';

      // Execute the command
      const commandStdin = isPipedInput && i > 0 ? stdin : initialStdin;
      const result = await this.executeCommand(parsed.command, parsed.args, parsed.quotedArgs, parsed.redirections, commandStdin);

      // Handle stdout based on whether this is piped to next command
      if (isPipedOutput && i < pipeline.commands.length - 1) {
        // This command's stdout goes to next command's stdin
        stdin = result.stdout;
      } else {
        // Accumulate stdout for final output
        accumulatedStdout += result.stdout;
      }

      // Always accumulate stderr
      accumulatedStderr += result.stderr;

      // Update last result for operator checks
      lastResult = result;
    }

    return {
      stdout: accumulatedStdout,
      stderr: accumulatedStderr,
      exitCode: lastResult.exitCode,
    };
  }

  private async executeCommand(
    command: string,
    args: string[],
    quotedArgs: boolean[],
    redirections: Redirection[],
    stdin: string
  ): Promise<ExecResult> {
    if (!command) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    // Check for compound commands (if statements collected by parser)
    if (command.startsWith('if ') || command.startsWith('if;')) {
      return this.executeIfStatement(command);
    }

    // Expand variables in command and args at execution time
    // Only expand unquoted args - single-quoted args are literal, double-quoted are already expanded at parse time
    const expandedCommand = this.expandVariables(command);
    const varExpandedArgs = args.map((arg, i) => quotedArgs[i] ? arg : this.expandVariables(arg));

    // Create glob expander for this execution
    const globExpander = new GlobExpander(this.fs, this.cwd);

    // Expand glob patterns in arguments (skip quoted args)
    const expandedArgs = await globExpander.expandArgs(varExpandedArgs, quotedArgs);

    // Handle built-in commands that modify shell state
    if (expandedCommand === 'cd') {
      return this.handleCd(expandedArgs);
    }
    if (expandedCommand === 'export') {
      return this.handleExport(expandedArgs);
    }
    if (expandedCommand === 'unset') {
      return this.handleUnset(expandedArgs);
    }
    if (expandedCommand === 'exit') {
      const code = expandedArgs[0] ? parseInt(expandedArgs[0], 10) : 0;
      return { stdout: '', stderr: '', exitCode: isNaN(code) ? 1 : code };
    }
    if (expandedCommand === 'local') {
      return this.handleLocal(expandedArgs);
    }

    // Handle variable assignment: VAR=value (no args, command contains =)
    if (expandedArgs.length === 0 && expandedCommand.includes('=')) {
      const eqIndex = expandedCommand.indexOf('=');
      const varName = expandedCommand.slice(0, eqIndex);
      // Check if it's a valid variable name
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
        const value = expandedCommand.slice(eqIndex + 1);
        this.env[varName] = value;
        return { stdout: '', stderr: '', exitCode: 0 };
      }
    }

    // Check for user-defined functions first
    const funcBody = this.functions.get(expandedCommand);
    if (funcBody) {
      // Push a new local scope for this function call
      this.localScopes.push(new Map());

      // Set positional parameters ($1, $2, etc.)
      for (let i = 0; i < expandedArgs.length; i++) {
        this.env[String(i + 1)] = expandedArgs[i];
      }
      this.env['@'] = expandedArgs.join(' ');
      this.env['#'] = String(expandedArgs.length);

      // Execute the function body
      const result = await this.exec(funcBody);

      // Pop the local scope and restore shadowed variables
      const localScope = this.localScopes.pop()!;
      for (const [varName, originalValue] of localScope) {
        if (originalValue === undefined) {
          delete this.env[varName];
        } else {
          this.env[varName] = originalValue;
        }
      }

      // Clean up positional parameters
      for (let i = 1; i <= expandedArgs.length; i++) {
        delete this.env[String(i)];
      }
      delete this.env['@'];
      delete this.env['#'];

      return result;
    }

    // Look up command - handle paths like /bin/ls
    let commandName = expandedCommand;
    if (expandedCommand.includes('/')) {
      // Extract the command name from the path
      commandName = expandedCommand.split('/').pop() || expandedCommand;
    }
    const cmd = this.commands.get(commandName);
    if (!cmd) {
      return {
        stdout: '',
        stderr: `bash: ${expandedCommand}: command not found\n`,
        exitCode: 127,
      };
    }

    // Execute the command
    const ctx: CommandContext = {
      fs: this.fs,
      cwd: this.cwd,
      env: this.env,
      stdin,
    };

    let result: ExecResult;
    try {
      result = await cmd.execute(expandedArgs, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        stdout: '',
        stderr: `${command}: ${message}\n`,
        exitCode: 1,
      };
    }

    // Apply redirections
    result = await this.applyRedirections(result, redirections);

    return result;
  }

  private async applyRedirections(result: ExecResult, redirections: Redirection[]): Promise<ExecResult> {
    let { stdout, stderr, exitCode } = result;

    for (const redir of redirections) {
      switch (redir.type) {
        case 'stdout':
          if (redir.target) {
            const filePath = this.resolvePath(redir.target);
            if (redir.append) {
              await this.fs.appendFile(filePath, stdout);
            } else {
              await this.fs.writeFile(filePath, stdout);
            }
            stdout = '';
          }
          break;

        case 'stderr':
          if (redir.target === '/dev/null') {
            stderr = '';
          } else if (redir.target) {
            const filePath = this.resolvePath(redir.target);
            if (redir.append) {
              await this.fs.appendFile(filePath, stderr);
            } else {
              await this.fs.writeFile(filePath, stderr);
            }
            stderr = '';
          }
          break;

        case 'stderr-to-stdout':
          stdout += stderr;
          stderr = '';
          break;
      }
    }

    return { stdout, stderr, exitCode };
  }

  private async handleCd(args: string[]): Promise<ExecResult> {
    const target = args[0] || this.env.HOME || '/';

    let newDir: string;
    if (target === '-') {
      newDir = this.previousDir;
    } else if (target === '~') {
      newDir = this.env.HOME || '/';
    } else {
      newDir = this.resolvePath(target);
    }

    try {
      const stat = await this.fs.stat(newDir);
      if (!stat.isDirectory) {
        return { stdout: '', stderr: `cd: ${target}: Not a directory\n`, exitCode: 1 };
      }
      this.previousDir = this.cwd;
      this.cwd = newDir;
      return { stdout: '', stderr: '', exitCode: 0 };
    } catch {
      return { stdout: '', stderr: `cd: ${target}: No such file or directory\n`, exitCode: 1 };
    }
  }

  private handleExport(args: string[]): ExecResult {
    for (const arg of args) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        const name = arg.slice(0, eqIndex);
        const value = arg.slice(eqIndex + 1);
        this.env[name] = value;
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  private handleUnset(args: string[]): ExecResult {
    for (const arg of args) {
      delete this.env[arg];
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  private handleLocal(args: string[]): ExecResult {
    // 'local' is only valid inside a function
    if (this.localScopes.length === 0) {
      return {
        stdout: '',
        stderr: 'bash: local: can only be used in a function\n',
        exitCode: 1,
      };
    }

    const currentScope = this.localScopes[this.localScopes.length - 1];

    for (const arg of args) {
      const eqIndex = arg.indexOf('=');
      let varName: string;
      let value: string | undefined;

      if (eqIndex > 0) {
        varName = arg.slice(0, eqIndex);
        value = arg.slice(eqIndex + 1);
      } else {
        varName = arg;
        value = undefined;
      }

      // Save the original value (or undefined if it didn't exist)
      // Only save if we haven't already saved it in this scope
      if (!currentScope.has(varName)) {
        currentScope.set(varName, this.env[varName]);
      }

      // Set the new value
      if (value !== undefined) {
        this.env[varName] = value;
      } else if (!(varName in this.env)) {
        // If no value and variable doesn't exist, set to empty string
        this.env[varName] = '';
      }
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  }

  private resolvePath(path: string): string {
    return this.fs.resolvePath(this.cwd, path);
  }

  /**
   * Expand variables in a string at execution time
   */
  private expandVariables(str: string): string {
    let result = '';
    let i = 0;

    while (i < str.length) {
      if (str[i] === '$' && i + 1 < str.length) {
        const nextChar = str[i + 1];

        // Handle ${VAR} and ${VAR:-default}
        if (nextChar === '{') {
          const closeIndex = str.indexOf('}', i + 2);
          if (closeIndex !== -1) {
            const content = str.slice(i + 2, closeIndex);
            const defaultMatch = content.match(/^([^:]+):-(.*)$/);
            if (defaultMatch) {
              const [, varName, defaultValue] = defaultMatch;
              result += this.env[varName] ?? defaultValue;
            } else {
              result += this.env[content] ?? '';
            }
            i = closeIndex + 1;
            continue;
          }
        }

        // Handle special variables: $@, $#, $$, $?, $!, $*
        if ('@#$?!*'.includes(nextChar)) {
          result += this.env[nextChar] ?? '';
          i += 2;
          continue;
        }

        // Handle positional parameters: $0, $1, $2, ...
        if (/[0-9]/.test(nextChar)) {
          result += this.env[nextChar] ?? '';
          i += 2;
          continue;
        }

        // Handle $VAR
        if (/[A-Za-z_]/.test(nextChar)) {
          let varName = nextChar;
          let j = i + 2;
          while (j < str.length && /[A-Za-z0-9_]/.test(str[j])) {
            varName += str[j];
            j++;
          }
          result += this.env[varName] ?? '';
          i = j;
          continue;
        }

        // Lone $ or unrecognized pattern
        result += str[i];
        i++;
      } else {
        result += str[i];
        i++;
      }
    }

    return result;
  }

  // Public API for file access
  async readFile(path: string): Promise<string> {
    return this.fs.readFile(this.resolvePath(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.fs.writeFile(this.resolvePath(path), content);
  }

  getCwd(): string {
    return this.cwd;
  }

  getEnv(): Record<string, string> {
    return { ...this.env };
  }
}
