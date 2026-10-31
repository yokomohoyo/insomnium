import { describe, expect, it } from '@jest/globals';
import { act, render } from '@testing-library/react';
import React, { createRef } from 'react';

import { ErrorModal, type ErrorModalHandle } from '../error-modal';

describe('<ErrorModal />', () => {
  const show = (error: Error) => {
    const ref = createRef<ErrorModalHandle>();
    const view = render(<ErrorModal ref={ref} />);
    act(() => ref.current?.show({ error }));
    return view;
  };

  it("leaves out Electron's wrapping of an error from the main process", () => {
    const view = show(new Error("Error invoking remote method 'grpc.loadMethodsFromReflection': Error: 14 UNAVAILABLE: No connection established"));
    // the message, that is: the stack trace keeps all of it
    expect(view.getByText('14 UNAVAILABLE: No connection established').className).toContain('notice');
  });

  it('wraps a long message rather than cutting it off', () => {
    const view = show(new Error('a long message'));
    expect(view.getByText('a long message').className).toContain('force-pre-wrap');
  });
});
