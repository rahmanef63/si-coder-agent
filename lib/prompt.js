// prompt.js — terminal input helpers shared by the onboarding/SC terminal flows.
//
// Extracted so the wizard and the new `sc` CLI cannot drift on the one behaviour that
// actually matters here: a secret must never be echoed, and must never reach argv.
const readline = require('readline');

const CR = 13, LF = 10, EOT = 4, ETX = 3, BS = 8, DEL = 127, SPACE = 32;
const RAW_PENDING = new WeakMap();

function stashRawPending(input, text) {
  if (!text) return;
  RAW_PENDING.set(input, `${RAW_PENDING.get(input) || ''}${text}`);
}
function takeRawPending(input) {
  const text = RAW_PENDING.get(input) || '';
  RAW_PENDING.delete(input);
  return text;
}

// Raw one-line reader used only when a caller explicitly wants Esc to cancel the
// current input and return to the surrounding UI. Returning null is intentionally
// distinct from an empty submitted value. Secret input never echoes typed characters.
function askRawLine(promptText, { hidden = false, escapeCancels = false, input = process.stdin, output = process.stdout } = {}) {
  return new Promise(resolve => {
    output.write(promptText);
    const wasRaw = Boolean(input.isRaw);
    input.setRawMode(true);
    input.resume();
    let buf = '', escapeTail = '', pasting = false, finished = false, escapeTimer;
    const markers = ['\x1b[200~', '\x1b[201~'];
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(escapeTimer);
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      resolve(value);
    };
    const onData = d => {
      if (finished) return;
      const text = escapeTail + d.toString('utf8');
      escapeTail = '';
      clearTimeout(escapeTimer);
      for (let i = 0; i < text.length; i++) {
        const ch = text[i], code = ch.charCodeAt(0);
        if (code === 27) {
          const tail = text.slice(i);
          const marker = markers.find(m => tail.startsWith(m));
          if (marker) { pasting = marker === markers[0]; i += marker.length - 1; continue; }
          if (markers.some(m => m.startsWith(tail))) {
            // PTYs may split a paste wrapper across separate data events. A bare
            // Escape must still cancel, rather than waiting forever for more bytes.
            escapeTail = tail;
            escapeTimer = setTimeout(() => {
              escapeTail = '';
              if (escapeCancels) finish(null);
            }, 100);
            return;
          }
          if (escapeCancels) return finish(null);
          // Never append terminal CSI bytes to a credential in non-menu mode.
          if (text[i + 1] === '[') {
            const sequence = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(tail);
            if (sequence) i += sequence[0].length - 1;
          }
          continue;
        }
        if (!pasting && (code === CR || code === LF || code === EOT)) {
          let next = i + 1;
          if (code === CR && text[next]?.charCodeAt(0) === LF) next++;
          stashRawPending(input, text.slice(next));
          return finish(buf.trim());
        }
        // A pasted newline must not submit the form or feed the next prompt.
        if (pasting && (code === CR || code === LF)) { buf += '\n'; continue; }
        if (code === ETX && !pasting) { output.write('\n'); process.exit(130); }
        if (!pasting && (code === BS || code === DEL)) {
          if (buf) { buf = buf.slice(0, -1); if (!hidden) output.write('\b \b'); }
        } else if (code >= SPACE && code !== DEL) {
          buf += ch;
          if (!hidden) output.write(ch);
        }
      }
    };
    input.on('data', onData);
    const pending = takeRawPending(input);
    if (pending) queueMicrotask(() => onData(Buffer.from(pending)));
  });
}

// A plain, single-shot line read (visible echo). TUI callers may opt into Esc cancellation;
// ordinary CLI callers keep readline behaviour for backwards compatibility.
function askVisible(promptText, options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  if (options.escapeCancels && input.isTTY) return askRawLine(promptText, { ...options, input, output, hidden: false });
  return new Promise(resolve => {
    const rl = readline.createInterface({ input, output });
    rl.question(promptText, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// A hidden line read: the prompt shows, keystrokes do not. Used for every secret
// so a shoulder-surfer or a scrollback log never captures the token. Falls back to
// a visible read when stdin is not a TTY (piped input can't enter raw mode) — the
// value still never touches argv, which is the leak that actually matters.
function askHidden(promptText, options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  if (!input.isTTY) return askVisible(promptText, { input, output });
  return askRawLine(promptText, { ...options, input, output, hidden: true });
}

// Reveal at most ~25% of a value (cap 4 chars) so short secrets aren't echoed whole.
function redactValue(val) {
  if (!val) return '';
  const n = Math.min(4, Math.floor(val.length / 4));
  return `${val.slice(0, n)}…[len=${val.length}]`;
}

// Interactive means BOTH ends are a terminal. A wizard that prompts on a closed or piped
// stdin does not "ask" — it blocks forever, which in CI reads as a hung job. Every
// auto-launch path must gate on this.
function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function confirm(promptText) {
  const a = (await askVisible(`${promptText} [y/N]: `)).toLowerCase();
  return a === 'y' || a === 'yes';
}

// ---------------------------------------------------------------------------
// Arrow-key pickers
// ---------------------------------------------------------------------------
// Typed comma-separated input works, but it makes the user retype identifiers they can
// already see on screen — and it silently accepts typos. These render a live list and let
// the terminal do what terminals do: ↑/↓ to move, Space to toggle, Enter to confirm.
//
// Rendering is deliberately dumb: no alt-screen, no cursor save/restore. It reprints in
// place by walking the cursor back up over the lines it wrote. That survives resizes,
// scrollback, and `less`-style pagers better than anything clever, and when it is done the
// list stays in the scrollback as a record of what was chosen.
const ESC = '\x1b';
const UP = `${ESC}[A`, DOWN = `${ESC}[B`, RIGHT = `${ESC}[C`, LEFT = `${ESC}[D`;

function hideCursor() { if (process.stdout.isTTY) process.stdout.write(`${ESC}[?25l`); }
function showCursor() { if (process.stdout.isTTY) process.stdout.write(`${ESC}[?25h`); }

function truncate(line) {
  const w = (process.stdout.columns || 80) - 1;
  return line.length > w ? line.slice(0, w - 1) + '…' : line;
}

// Shared engine for both pickers. `multi` decides whether Space toggles and whether the
// result is an array of ids or a single id. `tabs` is an optional list of
// { id, label, filter(item) } lenses over the same items.
//
// Key map, and why it is what it is: printable characters go to the SEARCH box, so the old
// single-letter shortcuts had to move. Space stays "toggle" rather than a space character —
// no provider id, target or profile name contains one, so the search box never needs it,
// and Space-to-toggle is what every checkbox list in a terminal does.
function picker({ title, hint, items, multi, preselected = [], tabs = null }) {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stdout;
    const selected = new Set(preselected);
    let cursor = 0;
    let printed = 0;
    let query = '';
    let tab = 0;

    const visible = () => {
      let list = items;
      if (tabs && tabs[tab] && tabs[tab].filter) list = list.filter(tabs[tab].filter);
      if (query) {
        const q = query.toLowerCase();
        list = list.filter(it => `${it.id} ${it.label} ${it.hint || ''}`.toLowerCase().includes(q));
      }
      return list;
    };

    const render = () => {
      const list = visible();
      if (cursor >= list.length) cursor = Math.max(0, list.length - 1);
      if (printed) output.write(`${ESC}[${printed}A`); // walk back over the previous frame
      output.write(`${ESC}[0J`);                        // clear from cursor to end of screen
      const lines = [title];

      if (tabs) {
        // Reverse-video the active tab. Counts come from the tab's own lens, so the labels
        // stay honest while a search is narrowing the list underneath.
        lines.push('  ' + tabs.map((t, i) => {
          const n = t.filter ? items.filter(t.filter).length : items.length;
          const label = ` ${t.label} ${n} `;
          return i === tab ? `${ESC}[7m${label}${ESC}[0m` : label;
        }).join(' '));
      }
      lines.push(`  search: ${query}${ESC}[4m ${ESC}[0m${query ? '' : '  (type to filter)'}`);
      lines.push(hint);
      lines.push('');

      if (list.length === 0) {
        lines.push(`  ${ESC}[2mno match for "${query}" — Esc clears the search${ESC}[0m`);
      }
      list.forEach((it, i) => {
        const here = i === cursor;
        const box = multi ? (selected.has(it.id) ? '[x] ' : '[ ] ') : (here ? '(o) ' : '( ) ');
        const pointer = here ? '❯ ' : '  ';
        const label = `${it.label}${it.hint ? `  — ${it.hint}` : ''}`;
        lines.push(truncate(here ? `${ESC}[7m${pointer}${box}${label}${ESC}[0m` : `${pointer}${box}${label}`));
      });
      output.write(lines.map(l => `${l}\n`).join(''));
      printed = lines.length;
    };

    const finish = (value) => {
      input.removeListener('data', onData);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      showCursor();
      resolve(value);
    };

    const onData = (d) => {
      const str = d.toString('utf8');
      // A single read can carry several keys (held arrow, fast paste) — walk the whole chunk.
      for (let i = 0; i < str.length; i++) {
        const rest = str.slice(i);
        const list = visible();
        if (rest.startsWith(UP))         { cursor = list.length ? (cursor - 1 + list.length) % list.length : 0; i += 2; continue; }
        if (rest.startsWith(DOWN))       { cursor = list.length ? (cursor + 1) % list.length : 0; i += 2; continue; }
        if (tabs && rest.startsWith(RIGHT)) { tab = (tab + 1) % tabs.length; cursor = 0; i += 2; continue; }
        if (tabs && rest.startsWith(LEFT))  { tab = (tab - 1 + tabs.length) % tabs.length; cursor = 0; i += 2; continue; }

        const ch = str[i];
        const code = ch.charCodeAt(0);
        if (code === 9) { if (tabs) { tab = (tab + 1) % tabs.length; cursor = 0; } }        // Tab
        else if (code === 13 || code === 10) {                                              // Enter
          const cur = visible();
          if (!multi && cur.length === 0) continue;
          // In a multi-picker, Enter is also the natural single-provider action: when the
          // user has not toggled anything with Space, select the highlighted row and finish.
          // Once any box is checked, Enter keeps its conventional "confirm selection" role.
          if (multi && selected.size === 0 && cur[cursor]) selected.add(cur[cursor].id);
          render();
          return finish(multi ? items.filter(it => selected.has(it.id)).map(it => it.id)
                              : cur[cursor].id);
        }
        else if (code === 3) { showCursor(); output.write('\n'); process.exit(130); }        // Ctrl-C
        else if (code === 1 && multi) {                                                     // Ctrl-A = all/none
          const cur = visible();
          const allOn = cur.length > 0 && cur.every(it => selected.has(it.id));
          cur.forEach(it => allOn ? selected.delete(it.id) : selected.add(it.id));
        }
        else if (code === 32 && multi) {                                                    // Space = toggle
          const cur = visible();
          if (cur[cursor]) {
            const id = cur[cursor].id;
            selected.has(id) ? selected.delete(id) : selected.add(id);
          }
        }
        else if (code === 127 || code === 8) { query = query.slice(0, -1); cursor = 0; }     // Backspace
        else if (code === 27 && rest.length === 1) {                                         // Esc
          // Two-stage, the way every search UI behaves: clear the filter first, cancel only
          // when there is nothing left to clear. Otherwise a typo costs the whole selection.
          if (query) { query = ''; cursor = 0; }
          else { render(); return finish(null); }
        }
        else if (code === 4) { render(); return finish(null); }                              // Ctrl-D
        else if (code >= 32 && code < 127) { query += ch; cursor = 0; }                      // search
      }
      render();
    };

    hideCursor();
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    render();
    input.on('data', onData);
  });
}



/** Multi-select checkbox list. Returns an array of ids, or null if cancelled. */
function selectMany(title, items, preselected = [], tabs = null) {
  return picker({
    title,
    hint: `  ↑/↓ move · Enter current/confirm · Space multi-select · ^A all/none${tabs ? ' · ←/→ tab' : ''} · type to search · Esc clear/cancel`,
    items, multi: true, preselected, tabs,
  });
}

/** Single-select list. Returns one id, or null if cancelled. */
function selectOne(title, items, tabs = null) {
  return picker({
    title,
    hint: `  ↑/↓ move${tabs ? ' · ←/→ tab' : ''} · type to search · Enter select · Esc clear/cancel`,
    items, multi: false, tabs,
  });
}

module.exports = {
  askVisible, askHidden, redactValue, isInteractive, confirm, selectOne, selectMany,
};
