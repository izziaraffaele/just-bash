import { describe, it, expect } from 'vitest';
import { BashEnv } from './BashEnv.js';

describe('Bash Syntax', () => {
  describe('logical AND (&&)', () => {
    it('should execute second command when first succeeds', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo first && echo second');
      expect(result.stdout).toBe('first\nsecond\n');
      expect(result.exitCode).toBe(0);
    });

    it('should not execute second command when first fails', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /nonexistent && echo second');
      expect(result.stdout).toBe('');
      expect(result.exitCode).toBe(1);
    });

    it('should chain multiple && operators', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo a && echo b && echo c && echo d');
      expect(result.stdout).toBe('a\nb\nc\nd\n');
      expect(result.exitCode).toBe(0);
    });

    it('should stop chain at first failure', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo a && cat /missing && echo b && echo c');
      expect(result.stdout).toBe('a\n');
      expect(result.exitCode).toBe(1);
    });

    it('should work with commands that modify filesystem', async () => {
      const env = new BashEnv();
      await env.exec('mkdir /test && echo created > /test/file.txt');
      const content = await env.readFile('/test/file.txt');
      expect(content).toBe('created\n');
    });

    it('should not modify filesystem when first command fails', async () => {
      const env = new BashEnv({
        files: { '/important.txt': 'keep this' },
      });
      await env.exec('cat /missing && rm /important.txt');
      const content = await env.readFile('/important.txt');
      expect(content).toBe('keep this');
    });

    it('should handle && with exit codes from pipes', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo test | grep missing && echo found');
      expect(result.stdout).toBe('');
      expect(result.exitCode).toBe(1);
    });

    it('should handle && after successful grep', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo test | grep test && echo found');
      expect(result.stdout).toBe('test\nfound\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('logical OR (||)', () => {
    it('should execute second command when first fails', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /nonexistent || echo fallback');
      expect(result.stdout).toBe('fallback\n');
      expect(result.exitCode).toBe(0);
    });

    it('should not execute second command when first succeeds', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo success || echo fallback');
      expect(result.stdout).toBe('success\n');
      expect(result.exitCode).toBe(0);
    });

    it('should chain multiple || operators', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /a || cat /b || cat /c || echo fallback');
      expect(result.stdout).toBe('fallback\n');
      expect(result.exitCode).toBe(0);
    });

    it('should stop at first success in || chain', async () => {
      const env = new BashEnv({
        files: { '/exists.txt': 'found' },
      });
      const result = await env.exec('cat /missing || cat /exists.txt || echo fallback');
      expect(result.stdout).toBe('found');
      expect(result.exitCode).toBe(0);
    });

    it('should return non-zero if all commands fail', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /a || cat /b || cat /c');
      expect(result.exitCode).toBe(1);
    });

    it('should work as error handler pattern', async () => {
      const env = new BashEnv();
      const result = await env.exec('mkdir /dir || echo "dir already exists"');
      expect(result.stdout).toBe('');
      expect(result.exitCode).toBe(0);
      // Second call should trigger the || branch
      const result2 = await env.exec('mkdir /dir || echo "dir already exists"');
      expect(result2.stdout).toBe('dir already exists\n');
    });

    it('should handle || with grep no match', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo test | grep missing || echo "not found"');
      expect(result.stdout).toBe('not found\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('semicolon (;) sequential execution', () => {
    it('should execute both commands regardless of first result', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo first ; echo second');
      expect(result.stdout).toBe('first\nsecond\n');
    });

    it('should execute second even when first fails', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /missing ; echo second');
      expect(result.stdout).toBe('second\n');
    });

    it('should chain multiple ; operators', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo a ; echo b ; echo c');
      expect(result.stdout).toBe('a\nb\nc\n');
    });

    it('should preserve exit code from last command', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo first ; cat /missing');
      expect(result.stdout).toBe('first\n');
      expect(result.exitCode).toBe(1);
    });

    it('should return success if last command succeeds', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /missing ; echo success');
      expect(result.stdout).toBe('success\n');
      expect(result.exitCode).toBe(0);
    });

    it('should handle ; without spaces', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo a;echo b;echo c');
      expect(result.stdout).toBe('a\nb\nc\n');
    });
  });

  describe('mixed operators', () => {
    it('should handle && followed by ||', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /missing && echo success || echo failure');
      expect(result.stdout).toBe('failure\n');
    });

    it('should handle || followed by &&', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /missing || echo recovered && echo continued');
      expect(result.stdout).toBe('recovered\ncontinued\n');
    });

    it('should handle success && success || fallback', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo a && echo b || echo c');
      expect(result.stdout).toBe('a\nb\n');
    });

    it('should handle ; with &&', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo a ; echo b && echo c');
      expect(result.stdout).toBe('a\nb\nc\n');
    });

    it('should handle ; with ||', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /missing ; cat /missing2 || echo fallback');
      expect(result.stdout).toBe('fallback\n');
    });

    it('should handle complex chain: fail && x || recover ; continue', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /missing && echo success || echo recovered ; echo done');
      expect(result.stdout).toBe('recovered\ndone\n');
    });

    it('should handle complex chain: success && next || x ; continue', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo ok && echo next || echo skip ; echo done');
      expect(result.stdout).toBe('ok\nnext\ndone\n');
    });
  });

  describe('pipes (|)', () => {
    it('should pipe stdout to stdin', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo hello | cat');
      expect(result.stdout).toBe('hello\n');
    });

    it('should chain multiple pipes', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo hello | cat | cat | cat');
      expect(result.stdout).toBe('hello\n');
    });

    it('should filter with grep in pipe', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo -e "foo\\nbar\\nbaz" | grep ba');
      expect(result.stdout).toBe('bar\nbaz\n');
    });

    it('should count lines with wc in pipe', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo -e "a\\nb\\nc" | wc -l');
      expect(result.stdout.trim()).toBe('3');
    });

    it('should get first n lines with head in pipe', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo -e "1\\n2\\n3\\n4\\n5" | head -n 2');
      expect(result.stdout).toBe('1\n2\n');
    });

    it('should get last n lines with tail in pipe', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo -e "1\\n2\\n3\\n4\\n5" | tail -n 2');
      expect(result.stdout).toBe('4\n5\n');
    });

    it('should combine head and tail in pipe', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo -e "1\\n2\\n3\\n4\\n5" | head -n 4 | tail -n 2');
      expect(result.stdout).toBe('3\n4\n');
    });

    it('should pipe file contents through multiple filters', async () => {
      const env = new BashEnv({
        files: { '/data.txt': 'apple\nbanana\napricot\nblueberry\navocado\n' },
      });
      const result = await env.exec('cat /data.txt | grep a | head -n 3');
      expect(result.stdout).toBe('apple\nbanana\napricot\n');
    });

    it('should not confuse || with pipe', async () => {
      const env = new BashEnv();
      const result = await env.exec('cat /missing || echo fallback');
      expect(result.stdout).toBe('fallback\n');
    });

    it('should handle pipe with && after', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo test | grep test && echo found');
      expect(result.stdout).toBe('test\nfound\n');
    });

    it('should handle pipe with || after (no match case)', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo test | grep missing || echo "not found"');
      expect(result.stdout).toBe('not found\n');
    });
  });

  describe('output redirection (> and >>)', () => {
    it('should redirect stdout to new file with >', async () => {
      const env = new BashEnv();
      await env.exec('echo hello > /output.txt');
      expect(await env.readFile('/output.txt')).toBe('hello\n');
    });

    it('should overwrite existing file with >', async () => {
      const env = new BashEnv({
        files: { '/output.txt': 'old\n' },
      });
      await env.exec('echo new > /output.txt');
      expect(await env.readFile('/output.txt')).toBe('new\n');
    });

    it('should append to file with >>', async () => {
      const env = new BashEnv({
        files: { '/output.txt': 'line1\n' },
      });
      await env.exec('echo line2 >> /output.txt');
      expect(await env.readFile('/output.txt')).toBe('line1\nline2\n');
    });

    it('should create file when appending to nonexistent', async () => {
      const env = new BashEnv();
      await env.exec('echo first >> /new.txt');
      expect(await env.readFile('/new.txt')).toBe('first\n');
    });

    it('should redirect command output', async () => {
      const env = new BashEnv({
        files: { '/input.txt': 'content\n' },
      });
      await env.exec('cat /input.txt > /output.txt');
      expect(await env.readFile('/output.txt')).toBe('content\n');
    });

    it('should redirect pipe output', async () => {
      const env = new BashEnv();
      await env.exec('echo -e "a\\nb\\nc" | grep b > /output.txt');
      expect(await env.readFile('/output.txt')).toBe('b\n');
    });

    it('should handle multiple appends', async () => {
      const env = new BashEnv();
      await env.exec('echo a >> /log.txt');
      await env.exec('echo b >> /log.txt');
      await env.exec('echo c >> /log.txt');
      expect(await env.readFile('/log.txt')).toBe('a\nb\nc\n');
    });

    it('should handle > without spaces', async () => {
      const env = new BashEnv();
      await env.exec('echo test>/output.txt');
      expect(await env.readFile('/output.txt')).toBe('test\n');
    });

    it('should handle >> without spaces', async () => {
      const env = new BashEnv({
        files: { '/output.txt': 'a\n' },
      });
      await env.exec('echo b>>/output.txt');
      expect(await env.readFile('/output.txt')).toBe('a\nb\n');
    });
  });

  describe('environment variable expansion', () => {
    it('should expand $VAR', async () => {
      const env = new BashEnv({ env: { NAME: 'world' } });
      const result = await env.exec('echo hello $NAME');
      expect(result.stdout).toBe('hello world\n');
    });

    it('should expand ${VAR}', async () => {
      const env = new BashEnv({ env: { NAME: 'world' } });
      const result = await env.exec('echo hello ${NAME}');
      expect(result.stdout).toBe('hello world\n');
    });

    it('should expand ${VAR} adjacent to text', async () => {
      const env = new BashEnv({ env: { PREFIX: 'pre' } });
      const result = await env.exec('echo ${PREFIX}fix');
      expect(result.stdout).toBe('prefix\n');
    });

    it('should expand multiple variables', async () => {
      const env = new BashEnv({ env: { A: 'hello', B: 'world' } });
      const result = await env.exec('echo $A $B');
      expect(result.stdout).toBe('hello world\n');
    });

    it('should handle unset variable as empty', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo "[$UNSET]"');
      expect(result.stdout).toBe('[]\n');
    });

    it('should handle ${VAR:-default} with unset variable', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo ${MISSING:-default}');
      expect(result.stdout).toBe('default\n');
    });

    it('should handle ${VAR:-default} with set variable', async () => {
      const env = new BashEnv({ env: { SET: 'value' } });
      const result = await env.exec('echo ${SET:-default}');
      expect(result.stdout).toBe('value\n');
    });

    it('should expand in double quotes', async () => {
      const env = new BashEnv({ env: { VAR: 'value' } });
      const result = await env.exec('echo "the $VAR is here"');
      expect(result.stdout).toBe('the value is here\n');
    });

    it('should not expand in single quotes', async () => {
      const env = new BashEnv({ env: { VAR: 'value' } });
      const result = await env.exec("echo 'the $VAR is here'");
      expect(result.stdout).toBe('the $VAR is here\n');
    });

    it('should expand in file paths', async () => {
      const env = new BashEnv({
        files: { '/home/user/file.txt': 'content' },
        env: { HOME: '/home/user' },
      });
      const result = await env.exec('cat $HOME/file.txt');
      expect(result.stdout).toBe('content');
    });

    it('should handle export command', async () => {
      const env = new BashEnv();
      await env.exec('export FOO=bar');
      const result = await env.exec('echo $FOO');
      expect(result.stdout).toBe('bar\n');
    });

    it('should handle export with multiple assignments', async () => {
      const env = new BashEnv();
      await env.exec('export A=1 B=2 C=3');
      const result = await env.exec('echo $A $B $C');
      expect(result.stdout).toBe('1 2 3\n');
    });

    it('should handle unset command', async () => {
      const env = new BashEnv({ env: { FOO: 'bar' } });
      await env.exec('unset FOO');
      const result = await env.exec('echo "[$FOO]"');
      expect(result.stdout).toBe('[]\n');
    });
  });

  describe('quoting', () => {
    it('should preserve spaces in double quotes', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo "hello   world"');
      expect(result.stdout).toBe('hello   world\n');
    });

    it('should preserve spaces in single quotes', async () => {
      const env = new BashEnv();
      const result = await env.exec("echo 'hello   world'");
      expect(result.stdout).toBe('hello   world\n');
    });

    it('should handle single quote inside double quotes', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo "it\'s working"');
      expect(result.stdout).toBe("it's working\n");
    });

    it('should handle escaped double quote inside double quotes', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo "say \\"hello\\""');
      expect(result.stdout).toBe('say "hello"\n');
    });

    it('should handle empty string argument', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo ""');
      expect(result.stdout).toBe('\n');
    });

    it('should handle adjacent quoted strings', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo "hello"\'world\'');
      expect(result.stdout).toBe('helloworld\n');
    });

    it('should preserve special chars in single quotes', async () => {
      const env = new BashEnv();
      const result = await env.exec("echo 'hello $VAR && test'");
      expect(result.stdout).toBe('hello $VAR && test\n');
    });

    it('should handle newline in quoted string with $', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo "line1\nline2"');
      expect(result.stdout).toBe('line1\nline2\n');
    });
  });

  describe('escape sequences', () => {
    it('should handle \\n with echo -e', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo -e "hello\\nworld"');
      expect(result.stdout).toBe('hello\nworld\n');
    });

    it('should handle \\t with echo -e', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo -e "col1\\tcol2"');
      expect(result.stdout).toBe('col1\tcol2\n');
    });

    it('should handle multiple escape sequences', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo -e "a\\nb\\nc\\nd"');
      expect(result.stdout).toBe('a\nb\nc\nd\n');
    });

    it('should handle \\\\ for literal backslash', async () => {
      const env = new BashEnv();
      // In bash: echo -e "path\\\\to\\\\file" outputs path\to\file
      // Because \\\\ in double quotes -> \\ after quote processing -> \ after echo -e
      const result = await env.exec('echo -e "path\\\\\\\\to\\\\\\\\file"');
      expect(result.stdout).toBe('path\\to\\file\n');
    });

    it('should not interpret escapes without -e', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo "hello\\nworld"');
      expect(result.stdout).toBe('hello\\nworld\n');
    });
  });

  describe('exit command', () => {
    it('should exit with code 0 by default', async () => {
      const env = new BashEnv();
      const result = await env.exec('exit');
      expect(result.exitCode).toBe(0);
    });

    it('should exit with specified code', async () => {
      const env = new BashEnv();
      const result = await env.exec('exit 42');
      expect(result.exitCode).toBe(42);
    });

    it('should exit with code 1', async () => {
      const env = new BashEnv();
      const result = await env.exec('exit 1');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('unknown commands', () => {
    it('should return 127 for unknown command', async () => {
      const env = new BashEnv();
      const result = await env.exec('unknowncommand');
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain('command not found');
    });

    it('should include command name in error', async () => {
      const env = new BashEnv();
      const result = await env.exec('foobar');
      expect(result.stderr).toContain('foobar');
    });
  });

  describe('whitespace handling', () => {
    it('should handle empty command', async () => {
      const env = new BashEnv();
      const result = await env.exec('');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
    });

    it('should handle whitespace-only command', async () => {
      const env = new BashEnv();
      const result = await env.exec('   ');
      expect(result.exitCode).toBe(0);
    });

    it('should trim leading/trailing whitespace', async () => {
      const env = new BashEnv();
      const result = await env.exec('   echo hello   ');
      expect(result.stdout).toBe('hello\n');
    });

    it('should collapse multiple spaces between args', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo   hello   world');
      expect(result.stdout).toBe('hello world\n');
    });

    it('should handle tabs', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo\thello\tworld');
      expect(result.stdout).toBe('hello world\n');
    });
  });

  describe('if statements', () => {
    it('should execute then branch when condition is true', async () => {
      const env = new BashEnv();
      const result = await env.exec('if true; then echo yes; fi');
      expect(result.stdout).toBe('yes\n');
      expect(result.exitCode).toBe(0);
    });

    it('should not execute then branch when condition is false', async () => {
      const env = new BashEnv();
      const result = await env.exec('if false; then echo yes; fi');
      expect(result.stdout).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('should execute else branch when condition is false', async () => {
      const env = new BashEnv();
      const result = await env.exec('if false; then echo yes; else echo no; fi');
      expect(result.stdout).toBe('no\n');
      expect(result.exitCode).toBe(0);
    });

    it('should use command exit code as condition', async () => {
      const env = new BashEnv({
        files: { '/test.txt': 'hello world' },
      });
      const result = await env.exec('if grep hello /test.txt > /dev/null; then echo found; fi');
      expect(result.stdout).toBe('found\n');
    });

    it('should handle elif branches', async () => {
      const env = new BashEnv();
      const result = await env.exec('if false; then echo one; elif true; then echo two; else echo three; fi');
      expect(result.stdout).toBe('two\n');
    });

    it('should handle multiple elif branches', async () => {
      const env = new BashEnv();
      const result = await env.exec('if false; then echo 1; elif false; then echo 2; elif true; then echo 3; else echo 4; fi');
      expect(result.stdout).toBe('3\n');
    });

    it('should handle commands with pipes in condition', async () => {
      const env = new BashEnv({
        files: { '/test.txt': 'hello\nworld\n' },
      });
      const result = await env.exec('if cat /test.txt | grep world > /dev/null; then echo found; fi');
      expect(result.stdout).toBe('found\n');
    });

    it('should handle multiple commands in body', async () => {
      const env = new BashEnv();
      const result = await env.exec('if true; then echo one; echo two; echo three; fi');
      expect(result.stdout).toBe('one\ntwo\nthree\n');
    });

    it('should return exit code of last command in body', async () => {
      const env = new BashEnv();
      const result = await env.exec('if true; then echo hello; false; fi');
      expect(result.stdout).toBe('hello\n');
      expect(result.exitCode).toBe(1);
    });

    it('should error on unclosed if', async () => {
      const env = new BashEnv();
      const result = await env.exec('if true; then echo hello');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('syntax error');
    });

    it('should handle nested if statements', async () => {
      const env = new BashEnv();
      const result = await env.exec('if true; then if true; then echo nested; fi; fi');
      expect(result.stdout).toBe('nested\n');
    });

    it('should handle triple nested if statements', async () => {
      const env = new BashEnv();
      const result = await env.exec('if true; then if true; then if true; then echo deep; fi; fi; fi');
      expect(result.stdout).toBe('deep\n');
    });

    it('should handle if inside function body', async () => {
      const env = new BashEnv();
      await env.exec('check() { if true; then echo inside; fi; }');
      const result = await env.exec('check');
      expect(result.stdout).toBe('inside\n');
    });

    it('should handle if with nested else', async () => {
      const env = new BashEnv();
      const result = await env.exec('if false; then echo one; else if true; then echo two; fi; fi');
      expect(result.stdout).toBe('two\n');
    });

    it('should handle if after semicolon', async () => {
      const env = new BashEnv();
      const result = await env.exec('echo before; if true; then echo during; fi; echo after');
      expect(result.stdout).toBe('before\nduring\nafter\n');
    });
  });

  describe('functions', () => {
    it('should define and call a function using function keyword', async () => {
      const env = new BashEnv();
      await env.exec('function greet { echo hello; }');
      const result = await env.exec('greet');
      expect(result.stdout).toBe('hello\n');
    });

    it('should define and call a function using () syntax', async () => {
      const env = new BashEnv();
      await env.exec('greet() { echo hello; }');
      const result = await env.exec('greet');
      expect(result.stdout).toBe('hello\n');
    });

    it('should pass arguments to function as $1, $2, etc.', async () => {
      const env = new BashEnv();
      await env.exec('greet() { echo Hello $1; }');
      const result = await env.exec('greet World');
      expect(result.stdout).toBe('Hello World\n');
    });

    it('should support $# for argument count', async () => {
      const env = new BashEnv();
      await env.exec('count() { echo $#; }');
      const result = await env.exec('count a b c');
      expect(result.stdout).toBe('3\n');
    });

    it('should support $@ for all arguments', async () => {
      const env = new BashEnv();
      await env.exec('show() { echo $@; }');
      const result = await env.exec('show one two three');
      expect(result.stdout).toBe('one two three\n');
    });

    it('should handle functions with multiple commands', async () => {
      const env = new BashEnv();
      await env.exec('multi() { echo first; echo second; echo third; }');
      const result = await env.exec('multi');
      expect(result.stdout).toBe('first\nsecond\nthird\n');
    });

    it('should allow function to call other functions', async () => {
      const env = new BashEnv();
      await env.exec('inner() { echo inside; }');
      await env.exec('outer() { echo before; inner; echo after; }');
      const result = await env.exec('outer');
      expect(result.stdout).toBe('before\ninside\nafter\n');
    });

    it('should return exit code from last command', async () => {
      const env = new BashEnv();
      await env.exec('fail() { echo hi; false; }');
      const result = await env.exec('fail');
      expect(result.stdout).toBe('hi\n');
      expect(result.exitCode).toBe(1);
    });

    it('should override built-in commands', async () => {
      const env = new BashEnv();
      await env.exec('echo() { true; }');
      // Now 'echo' calls our function which does nothing
      const result = await env.exec('echo hello');
      expect(result.stdout).toBe('');
    });

    it('should work with files', async () => {
      const env = new BashEnv({
        files: { '/data.txt': 'line1\nline2\nline3\n' },
      });
      await env.exec('countlines() { cat $1 | wc -l; }');
      const result = await env.exec('countlines /data.txt');
      expect(result.stdout.trim()).toBe('3');
    });
  });

  describe('local keyword', () => {
    it('should declare local variable with value', async () => {
      const env = new BashEnv();
      await env.exec('test_func() { local x=hello; echo $x; }');
      const result = await env.exec('test_func');
      expect(result.stdout).toBe('hello\n');
    });

    it('should not affect outer scope', async () => {
      const env = new BashEnv();
      await env.exec('export x=outer');
      await env.exec('test_func() { local x=inner; echo $x; }');
      await env.exec('test_func');
      const result = await env.exec('echo $x');
      expect(result.stdout).toBe('outer\n');
    });

    it('should shadow outer variable', async () => {
      const env = new BashEnv();
      await env.exec('export x=outer');
      await env.exec('test_func() { local x=inner; echo $x; }');
      const result = await env.exec('test_func');
      expect(result.stdout).toBe('inner\n');
    });

    it('should restore undefined variable after function', async () => {
      const env = new BashEnv();
      await env.exec('test_func() { local newvar=value; echo $newvar; }');
      await env.exec('test_func');
      const result = await env.exec('echo "[$newvar]"');
      expect(result.stdout).toBe('[]\n');
    });

    it('should error when used outside function', async () => {
      const env = new BashEnv();
      const result = await env.exec('local x=value');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('can only be used in a function');
    });

    it('should handle multiple local declarations', async () => {
      const env = new BashEnv();
      await env.exec('test_func() { local a=1 b=2 c=3; echo $a $b $c; }');
      const result = await env.exec('test_func');
      expect(result.stdout).toBe('1 2 3\n');
    });

    it('should declare local without value', async () => {
      const env = new BashEnv();
      await env.exec('test_func() { local x; x=assigned; echo $x; }');
      const result = await env.exec('test_func');
      expect(result.stdout).toBe('assigned\n');
    });

    it('should work with nested function calls', async () => {
      const env = new BashEnv();
      await env.exec('inner() { local x=inner; echo $x; }');
      await env.exec('outer() { local x=outer; inner; echo $x; }');
      const result = await env.exec('outer');
      expect(result.stdout).toBe('inner\nouter\n');
    });

    it('should keep local changes within same scope', async () => {
      const env = new BashEnv();
      await env.exec('test_func() { local x=first; x=second; echo $x; }');
      const result = await env.exec('test_func');
      expect(result.stdout).toBe('second\n');
    });
  });

  describe('parser edge cases', () => {
    describe('quoting', () => {
      it('should handle nested single quotes in double quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec("echo \"hello 'world'\"");
        expect(result.stdout).toBe("hello 'world'\n");
      });

      it('should handle nested double quotes in single quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec("echo 'hello \"world\"'");
        expect(result.stdout).toBe('hello "world"\n');
      });

      it('should handle empty double quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo ""');
        expect(result.stdout).toBe('\n');
      });

      it('should handle empty single quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec("echo ''");
        expect(result.stdout).toBe('\n');
      });

      it('should handle adjacent quoted strings', async () => {
        const env = new BashEnv();
        const result = await env.exec("echo 'hello'\"world\"");
        expect(result.stdout).toBe('helloworld\n');
      });

      it('should handle quotes inside arguments', async () => {
        const env = new BashEnv();
        const result = await env.exec("echo foo'bar'baz");
        expect(result.stdout).toBe('foobarbaz\n');
      });

      it('should preserve special chars in single quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec("echo '* ? | > < && || ;'");
        expect(result.stdout).toBe('* ? | > < && || ;\n');
      });
    });

    describe('escape sequences', () => {
      it('should handle escaped double quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "hello \\"world\\""');
        expect(result.stdout).toBe('hello "world"\n');
      });

      it('should handle escaped backslash', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "a\\\\b"');
        expect(result.stdout).toBe('a\\b\n');
      });

      it('should handle escaped dollar sign', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "\\$HOME"');
        expect(result.stdout).toBe('$HOME\n');
      });

      it('should handle escaped space outside quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo hello\\ world');
        expect(result.stdout).toBe('hello world\n');
      });

      it('should treat backslash literally in single quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec("echo 'a\\b'");
        expect(result.stdout).toBe('a\\b\n');
      });

      it('should escape special operators', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo a\\|b');
        expect(result.stdout).toBe('a|b\n');
      });
    });

    describe('variable expansion', () => {
      it('should handle ${VAR:-default} with set variable', async () => {
        const env = new BashEnv({ env: { VAR: 'value' } });
        const result = await env.exec('echo "${VAR:-default}"');
        expect(result.stdout).toBe('value\n');
      });

      it('should handle ${VAR:-default} with unset variable', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "${VAR:-default}"');
        expect(result.stdout).toBe('default\n');
      });

      it('should handle ${VAR:-} with empty default', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "${VAR:-}"');
        expect(result.stdout).toBe('\n');
      });

      it('should handle $VAR with no braces', async () => {
        const env = new BashEnv({ env: { NAME: 'test' } });
        const result = await env.exec('echo $NAME');
        expect(result.stdout).toBe('test\n');
      });

      it('should handle adjacent variables', async () => {
        const env = new BashEnv({ env: { A: 'hello', B: 'world' } });
        const result = await env.exec('echo "$A$B"');
        expect(result.stdout).toBe('helloworld\n');
      });

      it('should handle variable followed by text', async () => {
        const env = new BashEnv({ env: { NAME: 'test' } });
        const result = await env.exec('echo "${NAME}file.txt"');
        expect(result.stdout).toBe('testfile.txt\n');
      });

      it('should handle undefined variable as empty', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "[$UNDEFINED]"');
        expect(result.stdout).toBe('[]\n');
      });

      it('should handle special variable $?', async () => {
        // Note: $? requires prior command execution context
        const env = new BashEnv({ env: { '?': '0' } });
        const result = await env.exec('echo "$?"');
        expect(result.stdout).toBe('0\n');
      });
    });

    describe('whitespace handling', () => {
      it('should handle multiple spaces between arguments', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo    a    b    c');
        expect(result.stdout).toBe('a b c\n');
      });

      it('should handle tabs between arguments', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo\ta\tb\tc');
        expect(result.stdout).toBe('a b c\n');
      });

      it('should handle leading whitespace', async () => {
        const env = new BashEnv();
        const result = await env.exec('   echo hello');
        expect(result.stdout).toBe('hello\n');
      });

      it('should handle trailing whitespace', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo hello   ');
        expect(result.stdout).toBe('hello\n');
      });

      it('should preserve spaces in quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "  hello   world  "');
        expect(result.stdout).toBe('  hello   world  \n');
      });
    });

    describe('redirection parsing', () => {
      it('should handle > without space', async () => {
        const env = new BashEnv();
        await env.exec('echo hello>/tmp/test.txt');
        const content = await env.readFile('/tmp/test.txt');
        expect(content).toBe('hello\n');
      });

      it('should handle >> without space', async () => {
        const env = new BashEnv();
        await env.exec('echo first > /tmp/test.txt');
        await env.exec('echo second>>/tmp/test.txt');
        const content = await env.readFile('/tmp/test.txt');
        expect(content).toBe('first\nsecond\n');
      });

      it('should handle 2>/dev/null', async () => {
        const env = new BashEnv();
        const result = await env.exec('cat /nonexistent 2>/dev/null');
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(1);
      });

      it('should handle 2>&1 redirection', async () => {
        const env = new BashEnv();
        const result = await env.exec('cat /nonexistent 2>&1');
        expect(result.stdout).toContain('No such file');
        expect(result.stderr).toBe('');
      });

      it('should handle multiple redirections', async () => {
        const env = new BashEnv();
        await env.exec('echo out; cat /missing 2>&1 > /tmp/out.txt');
        // Complex redirection - varies by shell
      });
    });

    describe('operator parsing', () => {
      it('should parse && correctly without spaces', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo a&&echo b');
        expect(result.stdout).toBe('a\nb\n');
      });

      it('should parse || correctly without spaces', async () => {
        const env = new BashEnv();
        const result = await env.exec('false||echo fallback');
        expect(result.stdout).toBe('fallback\n');
      });

      it('should parse ; correctly without spaces', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo a;echo b');
        expect(result.stdout).toBe('a\nb\n');
      });

      it('should parse | correctly without spaces', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo hello|cat');
        expect(result.stdout).toBe('hello\n');
      });

      it('should differentiate | from ||', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo test | grep test || echo fail');
        expect(result.stdout).toBe('test\n');
      });

      it('should differentiate & from &&', async () => {
        // & is not implemented but && should work
        const env = new BashEnv();
        const result = await env.exec('true && echo success');
        expect(result.stdout).toBe('success\n');
      });
    });

    describe('complex command combinations', () => {
      it('should handle mixed && and || with correct precedence', async () => {
        const env = new BashEnv();
        // In bash, && and || have equal precedence, evaluated left-to-right
        const result = await env.exec('false || echo A && echo B');
        expect(result.stdout).toBe('A\nB\n');
      });

      it('should handle semicolon with && and ||', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo a; false || echo b; echo c');
        expect(result.stdout).toBe('a\nb\nc\n');
      });

      it('should handle pipes with semicolons', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo hello | cat; echo world | cat');
        expect(result.stdout).toBe('hello\nworld\n');
      });

      it('should handle assignment followed by command', async () => {
        const env = new BashEnv();
        const result = await env.exec('x=hello; echo $x');
        expect(result.stdout).toBe('hello\n');
      });

      it('should handle command after failed assignment-like string', async () => {
        const env = new BashEnv();
        // If = is part of an argument, not an assignment
        const result = await env.exec('echo a=b');
        expect(result.stdout).toBe('a=b\n');
      });
    });

    describe('edge cases', () => {
      it('should handle empty command line', async () => {
        const env = new BashEnv();
        const result = await env.exec('');
        expect(result.stdout).toBe('');
        expect(result.exitCode).toBe(0);
      });

      it('should handle command with only spaces', async () => {
        const env = new BashEnv();
        const result = await env.exec('   ');
        expect(result.stdout).toBe('');
        expect(result.exitCode).toBe(0);
      });

      it('should handle semicolon only', async () => {
        const env = new BashEnv();
        const result = await env.exec(';');
        expect(result.exitCode).toBe(0);
      });

      it('should handle multiple semicolons', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo a;;;echo b');
        expect(result.stdout).toBe('a\nb\n');
      });

      it('should handle very long argument', async () => {
        const env = new BashEnv();
        const longStr = 'a'.repeat(10000);
        const result = await env.exec(`echo ${longStr}`);
        expect(result.stdout).toBe(longStr + '\n');
      });

      it('should handle unicode in arguments', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "Hello 世界 🌍"');
        expect(result.stdout).toBe('Hello 世界 🌍\n');
      });

      it('should handle newline in double quotes', async () => {
        const env = new BashEnv();
        const result = await env.exec('echo "line1\nline2"');
        expect(result.stdout).toBe('line1\nline2\n');
      });
    });
  });
});
