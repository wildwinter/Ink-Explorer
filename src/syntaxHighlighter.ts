/**
 * Syntax highlighting for Ink and Dink source code.
 * Produces HTML with <span> elements styled via CSS classes.
 *
 * Colour classes and token mapping mirror the Dinky editor themes
 * (see ../dinky/src/tokenizer-rules.js for reference).
 */

// --- helpers ----------------------------------------------------------------

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function span(cls: string, text: string): string {
  if (!text) return '';
  return `<span class="${cls}">${esc(text)}</span>`;
}

// --- Dink dialogue ----------------------------------------------------------

const INK_KEYWORDS = new Set(['TODO', 'VAR', 'CONST', 'LIST', 'INCLUDE', 'EXTERNAL']);

function tryDinkDialogue(code: string): string | null {
  const nameMatch = code.match(/^([A-Z][A-Z0-9_]*)\s*/);
  if (!nameMatch) return null;
  if (INK_KEYWORDS.has(nameMatch[1])) return null;

  let pos = nameMatch[1].length;
  let result = span('ink-dink-name', nameMatch[1]);

  // whitespace after name
  while (pos < code.length && code[pos] === ' ') { result += ' '; pos++; }

  // optional (qualifier)
  if (pos < code.length && code[pos] === '(') {
    const end = code.indexOf(')', pos);
    if (end !== -1) {
      result += span('ink-dink-qual', code.substring(pos, end + 1));
      pos = end + 1;
    }
  }

  while (pos < code.length && code[pos] === ' ') { result += ' '; pos++; }

  // colon is required
  if (pos >= code.length || code[pos] !== ':') return null;
  result += esc(':');
  pos++;

  while (pos < code.length && code[pos] === ' ') { result += ' '; pos++; }

  // optional (direction)
  if (pos < code.length && code[pos] === '(') {
    const end = code.indexOf(')', pos);
    if (end !== -1) {
      result += span('ink-dink-dir', code.substring(pos, end + 1));
      pos = end + 1;
    }
  }

  while (pos < code.length && code[pos] === ' ') { result += ' '; pos++; }

  // remaining text
  if (pos < code.length) {
    result += highlightDinkText(code.substring(pos));
  }

  return result;
}

/** Highlight the text portion of a Dink dialogue line. */
function highlightDinkText(text: string): string {
  const divertIdx = text.indexOf('->');
  const tagIdx = text.indexOf('#');
  const braceIdx = text.indexOf('{');

  let boundary = text.length;
  if (divertIdx !== -1) boundary = Math.min(boundary, divertIdx);
  if (tagIdx !== -1) boundary = Math.min(boundary, tagIdx);
  if (braceIdx !== -1) boundary = Math.min(boundary, braceIdx);

  let result = '';
  if (boundary > 0) {
    result += span('ink-dink-text', text.substring(0, boundary));
  }
  if (boundary < text.length) {
    result += inlineElements(text, boundary);
  }
  return result;
}

// --- inline elements --------------------------------------------------------

/** Highlight inline elements (diverts, tags, brace-blocks) from `start`. */
function inlineElements(code: string, start: number): string {
  let result = '';
  let i = start;

  while (i < code.length) {
    // divert  ->
    if (code[i] === '-' && i + 1 < code.length && code[i + 1] === '>') {
      const m = code.substring(i).match(/^->\s*[\w.]*/);
      if (m) { result += span('ink-divert', m[0]); i += m[0].length; continue; }
    }

    // tag  #  (stop before closing bracket)
    if (code[i] === '#') {
      const rest = code.substring(i);
      const closeBracket = rest.indexOf(']');
      if (closeBracket !== -1) {
        result += span('ink-tag', rest.substring(0, closeBracket)) + esc(rest.substring(closeBracket));
      } else {
        result += span('ink-tag', rest);
      }
      break;
    }

    // brace block  { ... }
    if (code[i] === '{') {
      let depth = 1, j = i + 1;
      while (j < code.length && depth > 0) {
        if (code[j] === '{') depth++;
        else if (code[j] === '}') depth--;
        j++;
      }
      result += span('ink-code', code.substring(i, j));
      i = j;
      continue;
    }

    result += esc(code[i]);
    i++;
  }

  return result;
}

/** Highlight a content line (after structural checks). */
function highlightInline(code: string): string {
  let result = '';
  let i = 0;

  // leading whitespace
  while (i < code.length && (code[i] === ' ' || code[i] === '\t')) { result += code[i]; i++; }

  // choice markers  * + or gather  -
  if (i < code.length && (code[i] === '*' || code[i] === '+')) {
    let j = i;
    while (j < code.length && (code[j] === '*' || code[j] === '+')) j++;
    result += span('ink-choice', code.substring(i, j));
    i = j;
    while (i < code.length && code[i] === ' ') { result += ' '; i++; }
  } else if (i < code.length && code[i] === '-' && (i + 1 >= code.length || code[i + 1] !== '>')) {
    result += span('ink-gather', '-');
    i++;
    while (i < code.length && code[i] === ' ') { result += ' '; i++; }
  }

  // optional label  (name)
  if (i < code.length && code[i] === '(') {
    const labelMatch = code.substring(i).match(/^\(\w+\)/);
    if (labelMatch) {
      result += span('ink-code', labelMatch[0]);
      i += labelMatch[0].length;
      while (i < code.length && code[i] === ' ') { result += ' '; i++; }
    }
  }

  // try Dink dialogue on the remainder
  if (i < code.length) {
    const dink = tryDinkDialogue(code.substring(i));
    if (dink !== null) return result + dink;
  }

  // generic inline elements
  return result + inlineElements(code, i);
}

// --- line-level classification ----------------------------------------------

function highlightCode(code: string): string {
  if (!code) return '';
  const trimmed = code.trim();
  if (!trimmed) return esc(code);

  // knot header  == name ==
  if (/^={2,}/.test(trimmed)) return span('ink-knot', code);

  // stitch header  = name
  if (/^=(?!=)\s*\w/.test(trimmed)) return span('ink-stitch', code);

  // code keywords (whole line)
  if (/^(?:~|VAR\b|CONST\b|LIST\b|INCLUDE\b|EXTERNAL\b)/.test(trimmed))
    return span('ink-code', code);

  // pure divert line
  if (/^->/.test(trimmed)) return span('ink-divert', code);

  // TODO comment
  if (/^TODO\s*:/.test(trimmed)) return span('ink-comment', code);

  // closing brace (multi-line brace block)
  if (/^}/.test(trimmed)) return span('ink-code', code);

  return highlightInline(code);
}

function processLine(line: string): string {
  if (!line) return '';

  // split off trailing line comment
  const idx = line.indexOf('//');
  if (idx !== -1) {
    return highlightCode(line.substring(0, idx)) + span('ink-comment', line.substring(idx));
  }
  return highlightCode(line);
}

// --- public API -------------------------------------------------------------

export function highlightInkSyntax(source: string): string {
  const lines = source.split('\n');
  let inBlockComment = false;
  const out: string[] = [];

  for (const line of lines) {
    // inside a block comment
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end !== -1) {
        inBlockComment = false;
        out.push(span('ink-comment', line.substring(0, end + 2)) + processLine(line.substring(end + 2)));
      } else {
        out.push(span('ink-comment', line));
      }
      continue;
    }

    // check for block comment start (only if it precedes any line comment)
    const lc = line.indexOf('//');
    const bc = line.indexOf('/*');
    if (bc !== -1 && (lc === -1 || bc < lc)) {
      const endSame = line.indexOf('*/', bc + 2);
      if (endSame !== -1) {
        // block comment opens and closes on same line
        out.push(
          processLine(line.substring(0, bc)) +
          span('ink-comment', line.substring(bc, endSame + 2)) +
          processLine(line.substring(endSame + 2))
        );
      } else {
        inBlockComment = true;
        out.push(
          processLine(line.substring(0, bc)) +
          span('ink-comment', line.substring(bc))
        );
      }
      continue;
    }

    out.push(processLine(line));
  }

  return out.join('\n');
}
