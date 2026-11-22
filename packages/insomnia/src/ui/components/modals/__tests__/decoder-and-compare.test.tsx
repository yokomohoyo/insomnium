import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import React from 'react';

import { CompareResponsesModal } from '../compare-responses-modal';
import { DecoderModal } from '../decoder-modal';

jest.mock('react-aria', () => ({
  ...(jest.requireActual('react-aria') as object),
  OverlayContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const writeText = jest.fn();
(window as any).clipboard = { writeText };

describe('<DecoderModal />', () => {
  beforeEach(() => {
    writeText.mockClear();
  });

  it('converts the value, and says what it did', () => {
    const { getByLabelText, getByRole, getByTestId } = render(<DecoderModal />);

    fireEvent.change(getByLabelText('Value'), { target: { value: 'aGVsbG8gd29ybGQ=' } });
    fireEvent.click(within(getByRole('group', { name: 'Decode' })).getByRole('button', { name: 'Base64' }));

    expect((getByLabelText(/^Result/) as HTMLTextAreaElement).value).toBe('hello world');
    expect(getByTestId('decoder-done').textContent).toBe('Decode: Base64');
  });

  it('marks the decodings the value looks like', () => {
    const { getByLabelText, getByRole } = render(<DecoderModal text="a%20b" />);
    const decode = within(getByRole('group', { name: 'Decode' }));

    expect(decode.getByRole('button', { name: 'URL' }).getAttribute('title')).toBe('The value looks like this');
    expect(decode.getByRole('button', { name: 'Hex' }).getAttribute('title')).toBeNull();
    // and changes its mind with the value
    fireEvent.change(getByLabelText('Value'), { target: { value: '68656c6c6f' } });
    expect(decode.getByRole('button', { name: 'Hex' }).getAttribute('title')).toBe('The value looks like this');
  });

  it("says why when a value can't be converted, and shows no result", () => {
    const { getByLabelText, getByRole } = render(<DecoderModal text="not hex" />);

    fireEvent.click(within(getByRole('group', { name: 'Decode' })).getByRole('button', { name: 'Hex' }));

    expect(getByRole('alert').textContent).toBe("Can't decode that as Hex: It isn't pairs of hex digits");
    expect((getByLabelText(/^Result/) as HTMLTextAreaElement).value).toBe('');
  });

  it('puts the result back in as the value, for what is encoded twice', () => {
    // "a b", URL-encoded, then Base64
    const { getByLabelText, getByRole } = render(<DecoderModal text="YSUyMGI=" />);
    const decode = within(getByRole('group', { name: 'Decode' }));

    fireEvent.click(decode.getByRole('button', { name: 'Base64' }));
    fireEvent.click(getByRole('button', { name: 'Use as the Value' }));
    expect((getByLabelText('Value') as HTMLTextAreaElement).value).toBe('a%20b');
    fireEvent.click(decode.getByRole('button', { name: 'URL' }));

    expect((getByLabelText(/^Result/) as HTMLTextAreaElement).value).toBe('a b');
  });

  it('copies the result, and has nothing to do with no value', () => {
    const { getByLabelText, getByRole } = render(<DecoderModal />);

    expect((getByRole('button', { name: 'SHA-256' }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Copy Result' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(getByLabelText('Value'), { target: { value: 'hi' } });
    fireEvent.click(within(getByRole('group', { name: 'Encode' })).getByRole('button', { name: 'Hex' }));
    fireEvent.click(getByRole('button', { name: 'Copy Result' }));

    expect(writeText).toHaveBeenCalledWith('6869');
  });
});

const response = (id: string, patch: object = {}) => ({
  _id: id,
  statusCode: 200,
  statusMessage: 'OK',
  elapsedTime: 12,
  bytesRead: 31,
  bytesContent: 31,
  created: Date.UTC(2026, 10, 22, 10, 0, 0),
  headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Request-Id', value: id }],
  bodyPath: `/tmp/${id}`,
  bodyCompression: null,
  ...patch,
});
const BODIES: Record<string, string> = {
  res_new: '{"orders":[{"id":7,"item":"kettle"},{"id":8,"item":"cup"}],"total":2}',
  res_old: '{ "orders": [{ "id": 7, "item": "kettle" }], "total": 1 }',
  res_first: 'not found',
};
const RESPONSES = [response('res_new'), response('res_old'), response('res_first', { statusCode: 404, statusMessage: 'Not Found', headers: [{ name: 'Content-Type', value: 'text/plain' }] })];
// (not a mock: the test setup resets those between tests)
const readBody = async ({ _id }: { _id: string }) => ({ text: BODIES[_id], truncated: false });

describe('<CompareResponsesModal />', () => {
  it('compares the response being looked at with the one before it', async () => {
    const { findByLabelText, getByLabelText, getByTestId } = render(<CompareResponsesModal responses={RESPONSES as any} activeResponseId="res_new" readBody={readBody as any} />);

    const body = await findByLabelText('Body');
    expect((getByLabelText('First') as HTMLSelectElement).value).toBe('res_old');
    expect((getByLabelText('Second') as HTMLSelectElement).value).toBe('res_new');
    expect(getByTestId('compare-count-Status').textContent).toBe('the same');
    expect(getByTestId('compare-count-Headers').textContent).toBe('1 only in the first, 1 only in the second');
    // the JSON is laid out the same way for both, so only the data differs
    expect(getByTestId('compare-count-Body').textContent).toBe('1 only in the first, 5 only in the second');
    expect([...body.querySelectorAll('[data-kind="added"]')].map(row => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('"item": "cup"'), expect.stringContaining('"total": 2')]));
    expect([...body.querySelectorAll('[data-kind="removed"]')].map(row => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('"total": 1')]));
  });

  it('compares the two chosen, and shows a status that changed', async () => {
    const { findByLabelText, getByLabelText, getByTestId } = render(<CompareResponsesModal responses={RESPONSES as any} activeResponseId="res_new" readBody={readBody as any} />);
    await findByLabelText('Body');

    fireEvent.change(getByLabelText('First'), { target: { value: 'res_first' } });

    await waitFor(() => expect(getByTestId('compare-count-Status').textContent).toBe('1 only in the first, 1 only in the second'));
    const status = getByLabelText('Status');
    expect(status.querySelector('[data-kind="removed"]')!.textContent).toContain('404 Not Found');
    expect(status.querySelector('[data-kind="added"]')!.textContent).toContain('200 OK');
  });

  it('shows every line when asked, and only what differs otherwise', async () => {
    const { findByLabelText, getByLabelText } = render(<CompareResponsesModal responses={RESPONSES as any} activeResponseId="res_new" readBody={readBody as any} />);
    const headers = await findByLabelText('Headers');

    expect(headers.querySelectorAll('[data-kind="same"]').length).toBe(1);
    fireEvent.click(getByLabelText('Only what differs'));
    expect(getByLabelText('Body').querySelectorAll('[data-kind="same"]').length).toBeGreaterThan(3);
  });

  it('says so when the same response is chosen twice, and when the bodies were cut short', async () => {
    const cut = jest.fn(async () => ({ text: 'x', truncated: true }));
    const { findByText, getByLabelText } = render(<CompareResponsesModal responses={RESPONSES as any} activeResponseId="res_new" readBody={cut as any} />);

    expect(await findByText('Only the first megabyte of each body is compared.')).toBeTruthy();
    fireEvent.change(getByLabelText('First'), { target: { value: 'res_new' } });
    expect(await findByText('That is the same response twice.')).toBeTruthy();
  });

  it('compares the oldest response with the one after it', async () => {
    const { findByLabelText, getByLabelText } = render(<CompareResponsesModal responses={RESPONSES as any} activeResponseId="res_first" readBody={readBody as any} />);
    await findByLabelText('Body');

    expect((getByLabelText('Second') as HTMLSelectElement).value).toBe('res_first');
    expect((getByLabelText('First') as HTMLSelectElement).value).toBe('res_old');
  });
});
