import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';

const changes = [
  { path: 'a.yml', type: 'Request', status: 'modified', staged: false, added: false, editable: true },
  { path: 'b.yml', type: 'Request', status: 'modified', staged: true, added: false, editable: true },
  { path: 'c.yml', type: 'Request', status: 'added', staged: false, added: true, editable: true },
];

jest.mock('react-router-dom', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { forwardRef } = require('react') as typeof import('react');
  const Form = forwardRef<HTMLFormElement, React.FormHTMLAttributes<HTMLFormElement>>((props, ref) => <form ref={ref} {...props} />);
  return {
    ...(jest.requireActual('react-router-dom') as object),
    useParams: () => ({ organizationId: 'org_1', projectId: 'proj_1', workspaceId: 'wrk_1' }),
    useRouteLoaderData: () => ({ settings: {}, activeWorkspace: { scope: 'collection' } }),
    useFetcher: () => ({ state: 'idle', data: { changes, branch: 'main', statusNames: {} }, load: () => {}, submit: () => {}, Form }),
  };
});
jest.mock('react-aria', () => ({
  ...(jest.requireActual('react-aria') as object),
  OverlayContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../../base/modal', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { forwardRef, useImperativeHandle } = require('react') as typeof import('react');
  return { ...(jest.requireActual('../../base/modal') as object), Modal: forwardRef(({ children }: { children: React.ReactNode }, ref) => {
    useImperativeHandle(ref, () => ({ show: () => {}, hide: () => {} }));
    return <div>{children}</div>;
  }) };
});
jest.mock('../../tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GitStagingModal } = require('../git-staging-modal');

describe('<GitStagingModal />', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the row checkboxes controlled through select-all', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<GitStagingModal />);
    const rows = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[name="paths"]'));
    const all = container.querySelector('input[name="allModified"]') as HTMLInputElement;
    expect(rows().map(row => row.checked)).toEqual([false, true, false]);

    fireEvent.click(all);
    expect(rows().map(row => [row.checked, row.disabled])).toEqual([[true, true], [true, true], [false, false]]);

    // as before, the rows stay ticked and can be unticked one by one
    fireEvent.click(all);
    expect(rows().map(row => [row.checked, row.disabled])).toEqual([[true, false], [true, false], [false, false]]);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2]);
    expect(rows().map(row => row.checked)).toEqual([false, true, true]);

    expect(error.mock.calls.filter(call => /uncontrolled|defaultChecked/.test(String(call[0])))).toEqual([]);
  });
});
