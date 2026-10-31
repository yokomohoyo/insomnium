import React, { FC, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { clearConsole, ConsoleEntry, consoleEntries, subscribeToConsole } from '../../common/console-log';

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour12: false });
const size = (bytes?: number) => bytes === undefined ? '' : bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
const statusClass = (entry: ConsoleEntry) => entry.error || (entry.statusCode || 0) >= 400 ? 'danger' : (entry.statusCode || 0) >= 300 ? 'warning' : 'success';

const Row: FC<{ entry: ConsoleEntry }> = ({ entry }) => {
  const [open, setOpen] = useState(false);
  const details = entry.logs.length > 0 || Boolean(entry.error);
  return (
    <li data-testid="console-entry" className="border-b border-solid border-[--hl-sm]">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-3 py-1 text-left text-[length:var(--font-size-sm)] [font-family:var(--font-monospace)] text-[--color-font] hover:bg-[--hl-xs]"
        onClick={() => setOpen(!open)}
        aria-expanded={details ? open : undefined}
      >
        <span className="faint">{time(entry.at)}</span>
        <span className="w-14 flex-shrink-0">{entry.method}</span>
        <span className={`w-20 flex-shrink-0 ${statusClass(entry)}`}>{entry.error ? 'Error' : entry.statusCode}</span>
        <span className="flex-1 truncate selectable" title={entry.url}>{entry.name ? `${entry.name}  ` : ''}<span className="faint">{entry.url}</span></span>
        {entry.passed + entry.failed > 0 && (
          <span className={entry.failed ? 'danger' : 'success'}>{entry.passed}/{entry.passed + entry.failed} passed</span>
        )}
        {entry.logs.length > 0 && <span className="faint">{entry.logs.length} log{entry.logs.length === 1 ? '' : 's'}</span>}
        <span className="faint w-16 text-right">{entry.elapsedTime === undefined ? '' : `${Math.round(entry.elapsedTime)} ms`}</span>
        <span className="faint w-16 text-right">{size(entry.bytesRead)}</span>
      </button>
      {open && details && (
        <div className="px-3 pb-2 text-[length:var(--font-size-sm)] [font-family:var(--font-monospace)] selectable">
          {entry.error && <div className="danger" style={{ whiteSpace: 'pre-wrap' }}>{entry.error}</div>}
          {entry.logs.map((log, index) => (
            // eslint-disable-next-line react/no-array-index-key -- the logs are in order and don't change
            <div key={index} className={log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warning' : ''} style={{ whiteSpace: 'pre-wrap' }}>
              <span className="faint">{log.level}</span> {log.message}
            </div>
          ))}
        </div>
      )}
    </li>
  );
};

// The console: this session's sends, newest at the bottom, with their status,
// time, size, assertions and what their scripts logged
export const ConsoleDrawer: FC<{ onClose: () => void }> = ({ onClose }) => {
  const entries = useSyncExternalStore(subscribeToConsole, consoleEntries);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const shown = filter
    ? entries.filter(entry => `${entry.method} ${entry.name} ${entry.url} ${entry.statusCode || ''} ${entry.logs.map(log => log.message).join(' ')}`.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [shown.length]);

  return (
    <section
      aria-label="Console"
      className="absolute left-0 right-0 bottom-0 h-[35vh] z-20 flex flex-col bg-[--color-bg] text-[--color-font] text-[length:var(--font-size-sm)] border-t border-solid border-[--hl-md] shadow-lg"
      onKeyDown={event => event.key === 'Escape' && onClose()}
    >
      <div className="flex items-center gap-2 px-3 py-1 border-b border-solid border-[--hl-md]">
        <strong className="text-[length:var(--font-size-md)]">Console</strong>
        <span className="faint">{entries.length} sent this session</span>
        <span className="flex-1" />
        <input
          aria-label="Filter the console"
          className="px-2 py-1 border border-solid border-[--hl-sm] rounded-sm bg-transparent text-[--color-font] placeholder:text-[--hl]"
          placeholder="Filter"
          value={filter}
          onChange={event => setFilter(event.currentTarget.value)}
        />
        <button type="button" className="btn btn--compact" onClick={clearConsole}>Clear</button>
        <button type="button" className="btn btn--compact" aria-label="Close the console" onClick={onClose}><i className="fa fa-xmark" /></button>
      </div>
      {shown.length ? (
        <ul ref={listRef} className="flex-1 overflow-y-auto">
          {shown.map(entry => <Row key={entry.id} entry={entry} />)}
        </ul>
      ) : (
        <div className="pad faint">{entries.length ? 'Nothing matches the filter.' : 'Each HTTP request you send shows here, with what its scripts logged.'}</div>
      )}
    </section>
  );
};
