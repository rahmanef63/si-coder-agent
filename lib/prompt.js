// prompt.js — terminal input helpers shared by bin/onboard.js and bin/sc.js.
//
// Extracted so the wizard and the new `sc` CLI cannot drift on the one behaviour that
// actually matters here: a secret must never be echoed, and must never reach argv.
const readline = require('readline');

const CR = 13, LF = 10, EOT = 4, ETX = 3, BS = 8, DEL = 127, SPACE = 32;

// A plain, single-shot line read (visible echo). One interface per call so it can
// coexist with the raw-mode hidden reader below without them fighting over stdin.
function askVisible(promptText) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// A hidden line read: the prompt shows, keystrokes do not. Used for every secret
// so a shoulder-surfer or a scrollback log never captures the token. Falls back to
// a visible read when stdin is not a TTY (piped input can't enter raw mode) — the
// value still never touches argv, which is the leak that actually matters.
function askHidden(promptText) {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY) return askVisible(promptText);
  return new Promise(resolve => {
    output.write(promptText);
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    let buf = '';
    const onData = (d) => {
      for (const ch of d.toString('utf8')) {
        const code = ch.charCodeAt(0);
        if (code === CR || code === LF || code === EOT) {   // Enter / Ctrl-D
          input.removeListener('data', onData);
          input.setRawMode(wasRaw || false);
          input.pause();
          output.write('\n');
          return resolve(buf.trim());
        }
        if (code === ETX) { output.write('\n'); process.exit(130); } // Ctrl-C
        else if (code === BS || code === DEL) buf = buf.slice(0, -1); // Backspace
        else if (code >= SPACE) buf += ch;                            // ignore other control chars
      }
    };
    input.on('data', onData);
  });
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
    hint: `  ↑/↓ move · Space toggle · ^A all/none${tabs ? ' · ←/→ tab' : ''} · type to search · Enter confirm · Esc clear/cancel`,
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
