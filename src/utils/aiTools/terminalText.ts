// Terminal output often contains ANSI escape codes (colors, cursor movement)
// and other control characters that make it hard to parse as plain text.

// Based on common ANSI patterns (CSI/OSC) and kept intentionally conservative:
// - strips ANSI escape sequences
// - applies backspace processing
// - normalizes CR/LF
// - removes most remaining control characters

function stripAnsi(input: string): string {
   
  const ansiPattern =
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|(?:[0-9A-ORZcf-nqry=><~]))/g;

  // OSC (Operating System Command) sequences: ESC ] ... BEL or ESC \
  // eslint-disable-next-line no-control-regex
  const oscPattern = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;

  return input.replace(oscPattern, '').replace(ansiPattern, '');
}

function applyBackspaces(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (ch === '\b') {
      out = out.slice(0, -1);
      continue;
    }
    out += ch;
  }
  return out;
}

function stripControlChars(input: string): string {
  // Keep tab/newline, remove other C0 controls and DEL.
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
}

export function normalizeTerminalTextOutput(
  input: string,
  options?: { stripAnsi?: boolean }
): string {
  const strip = options?.stripAnsi !== false;

  let s = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = applyBackspaces(s);
  if (strip) {
    s = stripAnsi(s);
  }
  s = stripControlChars(s);
  return s;
}

