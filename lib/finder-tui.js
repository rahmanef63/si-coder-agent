'use strict';

// Finder-style alternate-screen TUI used by bare `sc`.
// Navigation never appends to terminal scrollback: the menu owns one alternate screen and
// repaints that same frame for every keypress. Command-oriented pickers remain in prompt.js.
const readline = require('readline');

const ESC = '\x1b';
const ALT_ON = `${ESC}[?1049h`;
const ALT_OFF = `${ESC}[?1049l`;
const HOME = `${ESC}[H`;
const CLEAR = `${ESC}[2J`;
const HIDE = `${ESC}[?25l`;
const SHOW = `${ESC}[?25h`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const REVERSE = `${ESC}[7m`;
const UP = `${ESC}[A`, DOWN = `${ESC}[B`, RIGHT = `${ESC}[C`, LEFT = `${ESC}[D`;
const CR = 13, LF = 10, TAB = 9, ETX = 3, EOT = 4, BS = 8, DEL = 127, SPACE = 32;

function stripAnsi(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

// Good-enough terminal cell width without adding a native dependency. SI-Coder labels are
// mostly ASCII; this covers common emoji/CJK/full-width ranges so column borders stay stable.
function cellWidth(value) {
  let n = 0;
  for (const ch of stripAnsi(value)) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    const wide =
      cp >= 0x1100 && (
        cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
        (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe19) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1faff) ||
        (cp >= 0x20000 && cp <= 0x3fffd)
      );
    n += wide ? 2 : 1;
  }
  return n;
}

function fit(value, width, { pad = true } = {}) {
  const text = stripAnsi(value).replace(/[\r\n\t]+/g, ' ');
  if (width <= 0) return '';
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = cellWidth(ch);
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  if (used < cellWidth(text) && width >= 1) {
    while (cellWidth(out) > Math.max(0, width - 1)) out = out.slice(0, -1);
    out += '…';
    used = cellWidth(out);
  }
  if (pad && used < width) out += ' '.repeat(width - used);
  return out;
}

function enterAlternateScreen(output = process.stdout) {
  if (!output.isTTY) return;
  output.write(`${ALT_ON}${HIDE}${HOME}${CLEAR}`);
}

function leaveAlternateScreen(output = process.stdout) {
  if (!output.isTTY) return;
  output.write(`${RESET}${SHOW}${ALT_OFF}`);
}

function clearAlternateScreen(output = process.stdout, { cursor = false } = {}) {
  if (!output.isTTY) return;
  output.write(`${cursor ? SHOW : HIDE}${HOME}${CLEAR}`);
}

function hideCursor(output = process.stdout) { if (output.isTTY) output.write(HIDE); }
function showCursor(output = process.stdout) { if (output.isTTY) output.write(SHOW); }

function itemText(item) {
  const kind = item?.kind === 'branch' ? '›' : '·';
  return `${kind} ${stripAnsi(item?.label || '')}`;
}

function windowFor(items, selectedIndex, height) {
  if (items.length <= height) return { start: 0, end: items.length };
  const half = Math.floor(height / 2);
  let start = Math.max(0, selectedIndex - half);
  start = Math.min(start, Math.max(0, items.length - height));
  return { start, end: Math.min(items.length, start + height) };
}

function renderTabs(sections, activeId, width) {
  const parts = ['  SECTIONS '];
  for (const section of sections || []) {
    const raw = ` ${section.label} `;
    parts.push(section.id === activeId ? `${REVERSE}${raw}${RESET}` : `${DIM}${raw}${RESET}`);
    parts.push(' ');
  }
  return fit(parts.join(''), width, { pad: false });
}

function renderBreadcrumb(breadcrumb, width) {
  const parts = ['  PATH     '];
  breadcrumb.forEach((label, index) => {
    const raw = ` ${stripAnsi(label)} `;
    const active = index === breadcrumb.length - 1;
    parts.push(active ? `${REVERSE}${raw}${RESET}` : `${DIM}${raw}${RESET}`);
    if (!active) parts.push(`${DIM}›${RESET}`);
  });
  return fit(parts.join(''), width, { pad: false });
}

function currentSectionId(stack, activeItem) {
  if (stack.length) return stack[0].id;
  return activeItem?.id || null;
}

function renderFinderFrame({
  title,
  breadcrumb,
  stack,
  columns,
  activeItems,
  cursor,
  query,
  sections,
  activity = [],
  output = process.stdout,
}) {
  const width = Math.max(48, output.columns || 100);
  const height = Math.max(16, output.rows || 28);
  const activeItem = activeItems[cursor] || null;
  const activeSection = currentSectionId(stack, activeItem);

  output.write(`${HOME}${CLEAR}${HIDE}`);
  const lines = [];
  lines.push(`${BOLD}${fit(`  ${title}`, width, { pad: false })}${RESET}`);
  lines.push(renderTabs(sections, activeSection, width));
  lines.push(renderBreadcrumb(breadcrumb, width));
  lines.push(`${DIM}${fit(`  ↑↓ move   Tab/→ deeper   Enter open/run   ←/Esc back   Ctrl-D quit`, width, { pad: false })}${RESET}`);
  lines.push(`${DIM}${fit(`  FILTER   ${query || '(type to filter current column)'}`, width, { pad: false })}${RESET}`);
  lines.push('─'.repeat(width));

  const maxCols = width >= 132 ? 4 : width >= 92 ? 3 : 2;
  const visibleColumns = columns.slice(-Math.max(1, Math.min(maxCols, columns.length)));
  const omitted = columns.length - visibleColumns.length;
  const separators = Math.max(0, visibleColumns.length - 1);
  const colWidth = Math.max(18, Math.floor((width - separators) / Math.max(1, visibleColumns.length)));
  const preview = Array.isArray(activeItem?.preview) ? activeItem.preview.filter(Boolean).map(stripAnsi) : [];
  const previewLines = preview.length ? Math.min(5, preview.length) + 2 : 0;
  const activityLines = activity.length ? Math.min(4, activity.length) + 2 : 0;
  const bodyHeight = Math.max(5, height - lines.length - previewLines - activityLines - 4);

  const prepared = visibleColumns.map((col, visibleIndex) => {
    const originalIndex = omitted + visibleIndex;
    const isActive = originalIndex === columns.length - 1;
    const items = isActive ? activeItems : col.items;
    const selectedId = isActive ? activeItem?.id : col.selectedId;
    const selectedIndex = Math.max(0, items.findIndex(it => it.id === selectedId));
    const win = windowFor(items, selectedIndex, Math.max(1, bodyHeight - 1));
    return { ...col, isActive, items, selectedId, selectedIndex, win };
  });

  const headerCells = prepared.map((col, i) => {
    const prefix = i === 0 && omitted > 0 ? '… / ' : '';
    const label = `${prefix}${col.title || 'SI-Coder'}`;
    return `${BOLD}${fit(` ${label}`, colWidth)}${RESET}`;
  });
  lines.push(headerCells.join('│'));

  for (let row = 0; row < bodyHeight - 1; row++) {
    const cells = prepared.map(col => {
      const idx = col.win.start + row;
      const item = idx < col.win.end ? col.items[idx] : null;
      if (!item) return ' '.repeat(colWidth);
      const selected = item.id === col.selectedId;
      const base = fit(` ${selected ? '❯' : ' '} ${itemText(item)}`, colWidth);
      if (selected && col.isActive) return `${REVERSE}${base}${RESET}`;
      if (selected) return `${BOLD}${base}${RESET}`;
      return base;
    });
    lines.push(cells.join('│'));
  }

  lines.push('─'.repeat(width));
  const detail = activeItem
    ? `${stripAnsi(activeItem.label)}${activeItem.hint ? ` — ${stripAnsi(activeItem.hint)}` : ''}`
    : '(no matching item)';
  lines.push(fit(`  INFO     ${detail}`, width, { pad: false }));

  if (preview.length) {
    lines.push(`${BOLD}${fit('  PREVIEW', width, { pad: false })}${RESET}`);
    for (const line of preview.slice(0, 5)) lines.push(fit(`  ${line}`, width, { pad: false }));
  }

  if (activity.length) {
    lines.push(`${DIM}${fit('  RESULT', width, { pad: false })}${RESET}`);
    for (const line of activity.slice(-Math.min(4, activity.length))) {
      lines.push(`${DIM}${fit(`  ${stripAnsi(line)}`, width, { pad: false })}${RESET}`);
    }
  }

  output.write(lines.slice(0, height).map(line => `${line}${RESET}\n`).join(''));
}

/**
 * One input phase of the Finder TUI. The alternate screen is owned by cmdMenu(), so this
 * function never enters/leaves it; it only repaints the same frame and returns a semantic
 * navigation event.
 */
function selectFinderFrame({
  title,
  breadcrumb,
  stack,
  columns,
  sections,
  initialId = null,
  initialQuery = '',
  activity = [],
  canBack = true,
}) {
  return new Promise(resolve => {
    const input = process.stdin;
    const output = process.stdout;
    const current = columns[columns.length - 1] || { items: [] };
    let query = initialQuery || '';
    let cursor = 0;
    let showActivity = activity.length > 0;
    const wasRaw = Boolean(input.isRaw);

    const visible = () => {
      if (!query) return current.items;
      const q = query.toLowerCase();
      return current.items.filter(it => `${it.id} ${stripAnsi(it.label)} ${stripAnsi(it.hint || '')}`.toLowerCase().includes(q));
    };

    const restoreCursor = () => {
      const list = visible();
      const idx = initialId ? list.findIndex(it => it.id === initialId) : -1;
      cursor = idx >= 0 ? idx : Math.min(cursor, Math.max(0, list.length - 1));
    };
    restoreCursor();

    const render = () => renderFinderFrame({
      title, breadcrumb, stack, columns,
      activeItems: visible(), cursor, query, sections, activity: showActivity ? activity : [], output,
    });

    const finish = event => {
      const list = visible();
      const selected = list[cursor] || null;
      input.removeListener('data', onData);
      if (input.isTTY) input.setRawMode(wasRaw);
      input.pause();
      resolve({ ...event, selectedId: selected?.id || null, query });
    };

    const activate = (item) => {
      if (!item) return;
      return finish({ type: item.kind === 'branch' ? 'open' : 'select', id: item.id });
    };

    const onData = d => {
      const str = d.toString('utf8');
      for (let i = 0; i < str.length; i++) {
        const rest = str.slice(i);
        const list = visible();
        if (rest.startsWith(UP)) {
          cursor = list.length ? (cursor - 1 + list.length) % list.length : 0;
          showActivity = false; i += 2; render(); continue;
        }
        if (rest.startsWith(DOWN)) {
          cursor = list.length ? (cursor + 1) % list.length : 0;
          showActivity = false; i += 2; render(); continue;
        }
        if (rest.startsWith(RIGHT)) {
          i += 2; return activate(list[cursor]);
        }
        if (rest.startsWith(LEFT)) {
          i += 2; return finish({ type: canBack ? 'back' : 'noop' });
        }

        const ch = str[i];
        const code = ch.charCodeAt(0);
        if (code === TAB) {
          const item = list[cursor];
          if (item?.kind === 'branch') return finish({ type: 'open', id: item.id });
        } else if (code === CR || code === LF) {
          return activate(list[cursor]);
        } else if (code === ETX || code === EOT) {
          return finish({ type: 'quit' });
        } else if (code === BS || code === DEL) {
          query = query.slice(0, -1); cursor = 0; showActivity = false;
        } else if (code === 27) {
          if (query) { query = ''; cursor = 0; showActivity = false; }
          else return finish({ type: canBack ? 'back' : 'noop' });
        } else if (code >= SPACE && code < 127) {
          query += ch; cursor = 0; showActivity = false;
        }
      }
      render();
    };

    if (input.isTTY) input.setRawMode(true);
    input.resume();
    render();
    input.on('data', onData);
  });
}

function waitForEnter(message = 'Press Enter to return to SI-Coder') {
  if (!process.stdin.isTTY) return Promise.resolve();
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n${message}`, () => { rl.close(); resolve(); });
  });
}

module.exports = {
  enterAlternateScreen,
  leaveAlternateScreen,
  clearAlternateScreen,
  hideCursor,
  showCursor,
  selectFinderFrame,
  renderFinderFrame,
  waitForEnter,
  stripAnsi,
  cellWidth,
};
