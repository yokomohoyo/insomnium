import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react';
import React, { createRef } from 'react';

import { PromptModal, type PromptModalHandle } from '../prompt-modal';

describe('<PromptModal />', () => {
  const open = (options: Parameters<PromptModalHandle['show']>[0]) => {
    const ref = createRef<PromptModalHandle>();
    const view = render(<PromptModal ref={ref} />);
    act(() => ref.current?.show(options));
    const input = view.container.ownerDocument.getElementById('prompt-input') as HTMLInputElement;
    const submit = view.getByText('Rename');
    return { input, submit };
  };

  it("won't take a blank name", () => {
    const onComplete = jest.fn();
    const { input, submit } = open({ title: 'Rename Document', submitName: 'Rename', defaultValue: 'Pets', onComplete });

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(submit);
    expect(onComplete).not.toHaveBeenCalled();
    expect(input.validationMessage).toBe('Enter a name');

    fireEvent.change(input, { target: { value: 'Pet Store' } });
    expect(input.validationMessage).toBe('');
    fireEvent.click(submit);
    expect(onComplete).toHaveBeenCalledWith('Pet Store');
  });
});
