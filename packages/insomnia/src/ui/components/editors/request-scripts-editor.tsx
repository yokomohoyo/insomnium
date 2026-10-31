import React, { FC } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import { docsScripts } from '../../../common/documentation';
import type { Request } from '../../../models/request';
import { useRequestSetter } from '../../hooks/use-request';
import { RequestLoaderData } from '../../routes/request';
import { Link } from '../base/link';
import { CodeEditor } from '../codemirror/code-editor';

const PRE_REQUEST_PLACEHOLDER = [
  '// Runs before the request is rendered and sent. For example:',
  "// insomnia.environment.set('timestamp', Date.now());",
  "// insomnia.request.headers.upsert({ key: 'X-Trace', value: insomnia.variables.get('trace') });",
].join('\n');

const AFTER_RESPONSE_PLACEHOLDER = [
  '// Runs on the response. Its tests join the Tests tab. For example:',
  "// insomnia.test('is OK', () => insomnia.expect(insomnia.response.code).to.equal(200));",
  "// insomnia.environment.set('token', insomnia.response.json().token);",
].join('\n');

// The request's two scripts (scripting/request-scripts.ts)
export const RequestScriptsEditor: FC = () => {
  const { requestId } = useParams() as { requestId: string };
  const { activeRequest } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const patchRequest = useRequestSetter();
  const request = activeRequest as Request;

  return (
    <div className="tall flex flex-col">
      <section aria-label="Pre-request script" className="flex flex-col" style={{ height: '45%' }}>
        <div className="pad-left pad-right pad-top-sm txt-sm">
          <strong>Pre-request</strong>
          <span className="faint">: can change insomnia.request, and set variables for this send</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <CodeEditor
            id="pre-request-script"
            ariaLabel="Pre-request script"
            mode="javascript"
            placeholder={PRE_REQUEST_PLACEHOLDER}
            defaultValue={request.preRequestScript || ''}
            onChange={preRequestScript => patchRequest(requestId, { preRequestScript })}
          />
        </div>
      </section>
      <section aria-label="After-response script" className="flex flex-col" style={{ height: '45%' }}>
        <div className="pad-left pad-right pad-top-sm txt-sm">
          <strong>After-response</strong>
          <span className="faint">: can check insomnia.response with insomnia.test and insomnia.expect</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <CodeEditor
            id="after-response-script"
            ariaLabel="After-response script"
            mode="javascript"
            placeholder={AFTER_RESPONSE_PLACEHOLDER}
            defaultValue={request.afterResponseScript || ''}
            onChange={afterResponseScript => patchRequest(requestId, { afterResponseScript })}
          />
        </div>
      </section>
      <p className="faint txt-sm pad-left pad-right no-margin">
        Scripts run in a sandbox, apart from the app, with insomnia.environment, .baseEnvironment, .variables, .request, .response, .test and .expect.
        pm is the same, for scripts from Postman. <Link href={docsScripts}>Scripts reference</Link>
      </p>
    </div>
  );
};
