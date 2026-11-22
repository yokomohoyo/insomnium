import React, { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';

import { type Conversion, CONVERSIONS, likelyDecodings } from '../../../common/decoder';
import { t } from '../../../common/i18n';
import { Modal, type ModalHandle, type ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';

const GROUPS: { group: Conversion['group']; label: () => string }[] = [
  { group: 'decode', label: () => t('Decode') },
  { group: 'encode', label: () => t('Encode') },
  { group: 'hash', label: () => t('Hash') },
];

// Converts a value between the encodings it goes through on its way to and
// from an API (common/decoder.ts). Nothing is sent anywhere: it's worked out
// here. What comes out can go back in, for a value encoded more than once.
export const DecoderModal: FC<ModalProps & { text?: string }> = ({ text = '', onHide }) => {
  const modalRef = useRef<ModalHandle>(null);
  const [input, setInput] = useState(text);
  const [output, setOutput] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    modalRef.current?.show();
  }, []);

  const likely = useMemo(() => likelyDecodings(input), [input]);

  const run = ({ id, name, group, run: convert }: Conversion) => {
    try {
      setOutput(convert(input));
      setDone(`${GROUPS.find(candidate => candidate.group === group)!.label()}: ${name}`);
      setError('');
    } catch (err) {
      setOutput('');
      setDone('');
      setError(t("Can't {what} that as {name}: {error}", { what: group === 'decode' ? t('decode') : group === 'encode' ? t('encode') : t('hash'), name, error: err instanceof Error ? err.message : String(err) }));
    }
    return id;
  };

  return (
    <OverlayContainer onClick={e => e.stopPropagation()}>
      <Modal ref={modalRef} onHide={onHide} wide tall>
        <ModalHeader>{t('Decoder')}</ModalHeader>
        <ModalBody className="pad">
          {/* clear of the scroll bar */}
          <div className="pr-6 flex flex-col gap-4">
            <p className="faint txt-sm no-margin">
              {t('Converts a value between encodings, here in the app: nothing is sent anywhere. What comes out can go back in, for a value encoded more than once.')}
            </p>
            <label className="txt-sm flex flex-col gap-2">
              {t('Value')}
              <textarea
                className="input-box w-full font-mono txt-sm p-2 m-0"
                // ready to be pasted into
                autoFocus
                rows={4}
                value={input}
                spellCheck={false}
                onChange={event => setInput(event.currentTarget.value)}
              />
            </label>
            {GROUPS.map(({ group, label }) => (
              <div key={group} role="group" aria-label={label()} className="flex items-center flex-wrap gap-2">
                <span className="txt-sm font-bold w-16 flex-shrink-0">{label()}</span>
                {CONVERSIONS.filter(conversion => conversion.group === group).map(conversion => (
                  <button
                    key={conversion.id}
                    // what the value looks like it is stands out
                    className={`btn btn--compact ${likely.includes(conversion.id) ? 'btn--clicky' : 'btn--outlined'}`}
                    title={likely.includes(conversion.id) ? t('The value looks like this') : undefined}
                    disabled={!input}
                    onClick={() => run(conversion)}
                  >
                    {conversion.name}
                  </button>
                ))}
              </div>
            ))}
            {error ? <p className="notice error no-margin" role="alert">{error}</p> : null}
            <label className="txt-sm flex flex-col gap-2">
              <span>
                {t('Result')}
                {done ? <span className="faint margin-left-sm" data-testid="decoder-done">{done}</span> : null}
              </span>
              <textarea className="input-box w-full font-mono txt-sm p-2 m-0" rows={6} value={output} readOnly spellCheck={false} />
            </label>
          </div>
        </ModalBody>
        <ModalFooter>
          <div className="margin-left flex gap-2">
            <button
              className="btn btn--compact modal__footer-secondary"
              disabled={!output}
              onClick={() => {
                setInput(output);
                setOutput('');
                setDone('');
              }}
            >
              {t('Use as the Value')}
            </button>
            <button className="btn btn--compact modal__footer-secondary" disabled={!output} onClick={() => window.clipboard.writeText(output)}>{t('Copy Result')}</button>
          </div>
          <button className="btn" onClick={() => modalRef.current?.hide()}>{t('Done')}</button>
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
