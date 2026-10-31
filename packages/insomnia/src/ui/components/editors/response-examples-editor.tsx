import React, { FC, useState } from 'react';
import { useParams, useRevalidator, useRouteLoaderData } from 'react-router-dom';

import * as models from '../../../models';
import { contentTypeOf, type ResponseExample, type ResponseExampleHeader } from '../../../models/response-example';
import { RequestLoaderData } from '../../routes/request';
import { PromptButton } from '../base/prompt-button';
import { CodeEditor } from '../codemirror/code-editor';

const headersAsText = (headers: ResponseExampleHeader[]) => headers.map(({ name, value }) => `${name}: ${value}`).join('\n');
const headersFromText = (text: string): ResponseExampleHeader[] => text.split('\n')
  .map(line => line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/))
  .filter((match): match is RegExpMatchArray => !!match)
  .map(([, name, value]) => ({ name, value }));

// a status an HTTP server can send, else null (the mock server would answer
// 500 for, say, 9999)
export const statusCodeFrom = (text: string) => {
  const code = Number(text);
  return Number.isInteger(code) && code >= 100 && code <= 599 ? code : null;
};

// A request's saved responses (models/response-example.ts): what it should
// answer, which the mock server serves
export const ResponseExamplesEditor: FC = () => {
  const { requestId } = useParams() as { requestId: string };
  const { examples = [] } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const { revalidate } = useRevalidator();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = examples.find(({ _id }) => _id === selectedId) || examples[0];

  // by id, so an editor that was made for an older copy doesn't undo a change
  const update = async (id: string, patch: Partial<ResponseExample>) => {
    const example = await models.responseExample.getById(id);
    if (example) {
      await models.responseExample.update(example, patch);
      revalidate();
    }
  };

  const add = async () => {
    const created = await models.responseExample.create({
      parentId: requestId,
      name: `Example ${examples.length + 1}`,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
    });
    setSelectedId(created._id);
    revalidate();
  };

  const remove = async (example: ResponseExample) => {
    await models.responseExample.remove(example);
    setSelectedId(undefined);
    revalidate();
  };

  if (!selected) {
    return (
      <div className="pad">
        <p className="faint">
          No examples yet. An example is a response this request should give: save one from a response, with <strong>Save as Example</strong> in its history menu, or add one.
        </p>
        <button className="btn btn--clicky" onClick={add}>Add Example</button>
      </div>
    );
  }

  return (
    <div className="tall flex flex-col">
      <div className="flex items-center gap-2 pad-sm">
        <select aria-label="Example" value={selected._id} onChange={event => setSelectedId(event.currentTarget.value)}>
          {examples.map(example => <option key={example._id} value={example._id}>{example.name}</option>)}
        </select>
        <button className="btn btn--compact" onClick={add}>Add</button>
        <PromptButton className="btn btn--compact" onClick={() => remove(selected)}>Delete</PromptButton>
      </div>
      <div key={selected._id} className="flex items-center gap-2 pad-left pad-right">
        <input
          className="flex-1"
          aria-label="Example name"
          defaultValue={selected.name}
          onBlur={event => event.currentTarget.value.trim() && update(selected._id, { name: event.currentTarget.value.trim() })}
        />
        <input
          className="w-20"
          aria-label="Status code"
          type="number"
          min={100}
          max={599}
          defaultValue={selected.statusCode}
          onBlur={event => {
            const statusCode = statusCodeFrom(event.currentTarget.value);
            if (statusCode === null) {
              // back to what it was
              event.currentTarget.value = String(selected.statusCode);
              return;
            }
            update(selected._id, { statusCode });
          }}
        />
        <input
          className="flex-1"
          aria-label="Status text"
          defaultValue={selected.statusMessage}
          onBlur={event => update(selected._id, { statusMessage: event.currentTarget.value })}
        />
      </div>
      <textarea
        key={`${selected._id}-headers`}
        aria-label="Headers"
        className="pad-sm margin-left margin-right txt-sm"
        rows={3}
        placeholder="Content-Type: application/json"
        defaultValue={headersAsText(selected.headers)}
        onBlur={event => update(selected._id, { headers: headersFromText(event.currentTarget.value) })}
      />
      <div className="flex-1 overflow-hidden">
        <CodeEditor
          key={`${selected._id}-body`}
          id="response-example-body"
          defaultValue={selected.body}
          mode={contentTypeOf(selected) || 'text/plain'}
          onChange={body => update(selected._id, { body })}
        />
      </div>
    </div>
  );
};
