import orderedJSON from 'json-order';
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';

import { JSON_ORDER_PREFIX, JSON_ORDER_SEPARATOR } from '../../../common/constants';
import { splitSecrets } from '../../../common/environment-secrets';
import { CodeEditor, CodeEditorHandle } from '../codemirror/code-editor';
import { checkNestedKeys, environmentFromRows, EnvironmentInfo, newRowId, rowsFromEnvironment, VariableRow } from './environment-variables';

export { checkNestedKeys, ensureKeyIsValid } from './environment-variables';
export type { EnvironmentInfo } from './environment-variables';

interface Props {
  environmentInfo: EnvironmentInfo;
  onBlur?: () => void;
  // variables can be secret (an Environment's, not a folder's overrides)
  allowSecrets?: boolean;
}

export interface EnvironmentEditorHandle {
  isValid: () => boolean;
  getValue: () => EnvironmentInfo | null;
}

type Mode = 'json' | 'table';
// the view last used, for every environment editor
const MODE_KEY = 'insomnium.environmentEditorMode';
const savedMode = (): Mode => {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'table' ? 'table' : 'json';
  } catch {
    return 'json';
  }
};

const asJson = ({ object, propertyOrder }: EnvironmentInfo) => orderedJSON.stringify(object, propertyOrder || null, JSON_ORDER_SEPARATOR);

// An environment's variables, as JSON or as a table of the top-level ones
export const EnvironmentEditor = forwardRef<EnvironmentEditorHandle, Props>(({
  environmentInfo,
  onBlur,
  allowSecrets = false,
}, ref) => {
  const editorRef = useRef<CodeEditorHandle>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>(savedMode);
  const [rows, setRows] = useState<VariableRow[]>(() => rowsFromEnvironment(environmentInfo));
  // the row Add Variable made, whose name is typed next
  const [addedRowId, setAddedRowId] = useState<string | null>(null);
  // what the JSON editor starts from, and a key to start it again
  const [json, setJson] = useState(() => asJson(environmentInfo));
  const [jsonKey, setJsonKey] = useState(0);
  // the secret variables and their values, while the JSON view (which shows
  // them empty) is open
  const secretsRef = useRef({ secretKeys: environmentInfo.secretKeys || [], secrets: environmentInfo.secrets || {} });
  // the secret values shown, by row
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

  const getJsonValue = useCallback(() => {
    const value = editorRef.current?.getValue();
    if (!value) {
      return null;
    }
    const parsed = orderedJSON.parse(value, JSON_ORDER_PREFIX, JSON_ORDER_SEPARATOR);
    return { object: parsed.object, propertyOrder: parsed.map || null };
  }, []);

  // the JSON view's value, with its secret variables' values kept apart again
  const getJsonInfo = useCallback((): EnvironmentInfo | null => {
    const value = getJsonValue();
    if (!value || !allowSecrets) {
      return value;
    }
    const split = splitSecrets(value.object, secretsRef.current.secretKeys, secretsRef.current.secrets);
    return { object: split.data, propertyOrder: value.propertyOrder, secretKeys: split.secretKeys, secrets: split.secrets };
  }, [allowSecrets, getJsonValue]);

  const getValue = useCallback(() => mode === 'json' ? getJsonInfo() : environmentFromRows(rows).info || null, [mode, rows, getJsonInfo]);

  useImperativeHandle(ref, () => ({
    isValid: () => !error,
    getValue,
  }), [error, getValue]);

  const switchTo = (next: Mode) => {
    if (next === mode) {
      return;
    }
    if (next === 'table') {
      let value: EnvironmentInfo | null = null;
      try {
        value = getJsonInfo();
      } catch (err) {
        setError(`Fix the JSON first: ${(err as Error).message}`);
        return;
      }
      setRows(rowsFromEnvironment(value || { object: {}, propertyOrder: null }));
    } else {
      const result = environmentFromRows(rows);
      if (!result.info) {
        setError(result.error);
        return;
      }
      secretsRef.current = { secretKeys: result.info.secretKeys || [], secrets: result.info.secrets || {} };
      setJson(asJson(result.info));
      setJsonKey(key => key + 1);
    }
    setError('');
    setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // the view isn't remembered
    }
  };

  // the table changed: check it, and let the parent save it once it has rendered
  const changeRows = (next: VariableRow[], save = false) => {
    setRows(next);
    setError(environmentFromRows(next).error || '');
    if (save) {
      setTimeout(() => onBlur?.());
    }
  };
  const changeRow = (id: string, patch: Partial<VariableRow>, save = false) => changeRows(rows.map(row => row.id === id ? { ...row, ...patch } : row), save);
  const toggleRevealed = (id: string) => setRevealed(shown => {
    const next = new Set(shown);
    if (!next.delete(id)) {
      next.add(id);
    }
    return next;
  });
  const secretNames = mode === 'json' ? secretsRef.current.secretKeys : [];

  return (
    <div className="environment-editor">
      <div className="environment-editor__modes" role="group" aria-label="Environment view">
        {(['table', 'json'] as const).map(view => (
          <button
            key={view}
            className={`btn btn--super-compact ${mode === view ? 'btn--outlined' : ''}`}
            aria-pressed={mode === view}
            onClick={() => switchTo(view)}
          >
            {view === 'table' ? 'Table' : 'JSON'}
          </button>
        ))}
      </div>
      {mode === 'json' ? (
        <CodeEditor
          key={jsonKey}
          id="environment-editor"
          ariaLabel="Environment data"
          ref={editorRef}
          autoPrettify
          enableNunjucks
          onChange={() => {
            setError('');
            try {
              const value = getJsonValue();
              // Check for invalid key names
              if (value?.object) {
                // Check root and nested properties
                const err = checkNestedKeys(value.object);
                if (err) {
                  setError(err);
                }
              }
            } catch (err) {
              setError(err.message);
            }
          }}
          defaultValue={json}
          mode="application/json"
          onBlur={onBlur}
        />
      ) : (
        <div className="environment-editor__table scrollable">
          <table className="table--fancy table--compact wide" aria-label="Variables">
            <thead>
              <tr>
                <th>Name</th>
                <th>Value</th>
                <th>Type</th>
                {allowSecrets && <th title="Kept on this computer only, encrypted, and not synced or exported">Secret</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td>
                    <input aria-label="Variable name" className="wide" autoFocus={row.id === addedRowId} value={row.name} placeholder="name" onChange={event => changeRow(row.id, { name: event.currentTarget.value })} onBlur={onBlur} />
                  </td>
                  <td>
                    <div className="environment-editor__value">
                      <input
                        aria-label="Variable value"
                        className="wide"
                        type={row.secret && !revealed.has(row.id) ? 'password' : 'text'}
                        value={row.value}
                        placeholder={row.type === 'json' ? '42, true, ["a"], {"a": 1}' : 'value or {{ variable }}'}
                        onChange={event => changeRow(row.id, { value: event.currentTarget.value })}
                        onBlur={onBlur}
                      />
                      {row.secret && (
                        <button className="btn btn--super-compact" aria-label={`${revealed.has(row.id) ? 'Hide' : 'Show'} ${row.name || 'value'}`} onClick={() => toggleRevealed(row.id)}>
                          <i className={`fa ${revealed.has(row.id) ? 'fa-eye-slash' : 'fa-eye'}`} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <select aria-label="Variable type" value={row.type} disabled={row.secret} onChange={event => changeRow(row.id, { type: event.currentTarget.value as VariableRow['type'] }, true)}>
                      <option value="text">Text</option>
                      <option value="json">JSON</option>
                    </select>
                  </td>
                  {allowSecrets && (
                    <td>
                      {/* a secret is text: its value as written, kept apart */}
                      <input type="checkbox" aria-label={`${row.name || 'Variable'} is secret`} checked={!!row.secret} onChange={event => changeRow(row.id, { secret: event.currentTarget.checked, type: 'text' }, true)} />
                    </td>
                  )}
                  <td>
                    <button className="btn btn--super-compact" aria-label={`Delete ${row.name || 'variable'}`} onClick={() => changeRows(rows.filter(({ id }) => id !== row.id), true)}>
                      <i className="fa fa-trash-o" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn btn--compact"
            onClick={() => {
              const id = newRowId();
              setAddedRowId(id);
              changeRows([...rows, { id, name: '', value: '', type: 'text' }]);
            }}
          >
            <i className="fa fa-plus space-right" /> Add Variable
          </button>
        </div>
      )}
      {secretNames.length > 0 && (
        <p className="faint txt-sm margin-left margin-right">
          {`Secret values (${secretNames.join(', ')}) are kept apart and show as "" here. Edit them in the table, or type a new one here.`}
        </p>
      )}
      {error && <p className="notice error margin">{error}</p>}
    </div>
  );
});
EnvironmentEditor.displayName = 'EnvironmentEditor';
