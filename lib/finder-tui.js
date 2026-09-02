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
const CUP = (row, col = 1) => `${ESC}[${row};${col}H`;
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


function chooseVisibleColumns(columns, slotCount) {
  const count = Math.max(1, Math.min(slotCount, columns.length));
  const fallback = columns.slice(-count);
  if (slotCount !== 4 || columns.length <= 4) return fallback;

  const providerListIndex = columns.findIndex(col => col.nodeId === 'providers');
  if (providerListIndex < 0) return fallback;
  // Do not change the familiar v0.8.9 provider-entry layout while Providers is still
  // visible naturally. The anchor only activates at the exact depth where last-four
  // would otherwise remove it.
  if (fallback.some(col => col.nodeId === 'providers')) return fallback;

  const providerIndex = columns.findIndex((col, i) => i > providerListIndex && String(col.nodeId || '').startsWith('provider:'));
  if (providerIndex < 0) return fallback;
  const providerList = columns[providerListIndex];
  const provider = columns[providerIndex];
  const tail = columns.slice(providerIndex + 1);
  if (!tail.length) return fallback;

  const connectionIndex = tail.findIndex(col => String(col.nodeId || '').startsWith('connection:'));
  let right = [];
  if (connectionIndex >= 0) {
    const connection = tail[connectionIndex];
    const deepest = tail[tail.length - 1];
    if (deepest === connection) {
      const siblingList = connectionIndex > 0 ? tail[connectionIndex - 1] : null;
      right = siblingList ? [siblingList, connection] : [connection];
    } else {
      // Skip structural Connections/Credentials bridge columns once a concrete connection
      // exists. Keep the connection identity and the deepest actionable layer instead.
      right = [connection, deepest];
    }
  } else {
    right = tail.slice(-2);
  }

  const selected = [providerList, provider, ...right];
  const unique = [];
  for (const col of selected) if (col && !unique.includes(col)) unique.push(col);
  return unique.slice(0, 4);
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
  const terminalWidth = Math.max(48, output.columns || 100);
  // Keep one physical cell unused at the right edge. Some terminal emulators (notably
  // Windows Terminal over an SSH PTY) can auto-wrap a row written exactly to the last
  // column, which scrolls a full-screen TUI even when the logical frame height is correct.
  const width = Math.max(47, terminalWidth - 1);
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

  // Wide Finder views always reserve four stable column slots. This prevents the first
  // three columns from resizing from 1/3 -> 1/4 when the user opens Providers.
  //
  // Provider subtrees need one extra rule: once Connections/Credentials add more depth,
  // a naive `last four columns` window drops the Providers list itself. That makes the
  // same provider screen feel structurally different as soon as the user drills down.
  // Keep Providers + the selected provider anchored on wide screens, then spend the two
  // right-hand slots on the selected connection and the deepest active layer. PATH keeps
  // the omitted user/root context visible without wasting Finder columns on it.
  const slotCount = terminalWidth >= 132 ? 4 : terminalWidth >= 92 ? 3 : 2;
  const visibleColumns = chooseVisibleColumns(columns, slotCount);
  const omitted = Math.max(0, columns.length - visibleColumns.length);
  const separators = Math.max(0, slotCount - 1);
  const colWidth = Math.max(18, Math.floor((width - separators) / slotCount));
  const preview = Array.isArray(activeItem?.preview) ? activeItem.preview.filter(Boolean).map(stripAnsi) : [];

  // Give the lower description/help area meaningful vertical space instead of leaving a
  // mostly empty Finder body when a column has only a few items. Taller terminals get eight
  // detail rows; compact terminals degrade without pushing the frame beyond the viewport.
  // RESULT temporarily replaces PREVIEW and uses the same reserved height.
  const detailRows = height >= 26 ? 8 : height >= 22 ? 6 : 4;
  const footerRows = 3 + detailRows; // separator + INFO + PREVIEW/RESULT label + details
  const bodyHeight = Math.max(3, height - lines.length - footerRows);

  const prepared = visibleColumns.map((col, visibleIndex) => {
    const originalIndex = omitted + visibleIndex;
    const isActive = originalIndex === columns.length - 1;
    const items = isActive ? activeItems : col.items;
    const selectedId = isActive ? activeItem?.id : col.selectedId;
    const selectedIndex = Math.max(0, items.findIndex(it => it.id === selectedId));
    const win = windowFor(items, selectedIndex, Math.max(1, bodyHeight - 1));
    return { ...col, isActive, items, selectedId, selectedIndex, win };
  });

  const blankSlots = Math.max(0, slotCount - prepared.length);
  const headerCells = prepared.map((col, i) => {
    const prefix = i === 0 && omitted > 0 ? '… / ' : '';
    const label = `${prefix}${col.title || 'SI-Coder'}`;
    return `${BOLD}${fit(` ${label}`, colWidth)}${RESET}`;
  });
  for (let i = 0; i < blankSlots; i++) headerCells.push(' '.repeat(colWidth));
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
    for (let i = 0; i < blankSlots; i++) cells.push(' '.repeat(colWidth));
    lines.push(cells.join('│'));
  }

  lines.push('─'.repeat(width));
  const detail = activeItem
    ? `${stripAnsi(activeItem.label)}${activeItem.hint ? ` — ${stripAnsi(activeItem.hint)}` : ''}`
    : '(no matching item)';
  lines.push(fit(`  INFO     ${detail}`, width, { pad: false }));

  const footerTitle = activity.length ? 'RESULT' : 'PREVIEW';
  const footerBody = activity.length
    ? activity.slice(-detailRows).map(stripAnsi)
    : preview.slice(0, detailRows);
  lines.push(`${activity.length ? DIM : BOLD}${fit(`  ${footerTitle}`, width, { pad: false })}${RESET}`);
  for (let i = 0; i < detailRows; i++) {
    const value = footerBody[i] || '';
    lines.push(`${activity.length ? DIM : ''}${fit(`  ${value}`, width, { pad: false })}${activity.length ? RESET : ''}`);
  }

  // Paint every terminal row by absolute cursor position instead of streaming lines with
  // `\n`. This keeps the alternate screen non-scrolling across terminal emulators/SSH PTYs.
  // Combined with the one-cell right margin above, a redraw cannot trigger implicit wrap or
  // push the header out of the viewport.
  const frame = lines.slice(0, height);
  while (frame.length < height) frame.push('');
  output.write(frame.map((line, index) => `${CUP(index + 1, 1)}${line}${RESET}`).join(''));
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
  chooseVisibleColumns,
  waitForEnter,
  stripAnsi,
  cellWidth,
};
