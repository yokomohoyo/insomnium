import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import { t } from '../../../common/i18n';
import imgSrcCore from '../../../icons/256x256.png';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { Icon } from '../icon';

const REPO_URL = 'https://github.com/yokomohoyo/insomnium';

// what Help → About shows, from the main process
export interface AboutDetails {
  productName: string;
  version: string;
  // the build and runtime, as label and value
  rows: [string, string][];
}

export interface AboutModalHandle {
  show: (details: AboutDetails) => void;
  hide: () => void;
}

export const aboutText = ({ productName, version, rows }: AboutDetails) =>
  [`${productName} ${version}`, ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n');

export const AboutModal = forwardRef<AboutModalHandle, ModalProps>((_, ref) => {
  const modalRef = useRef<ModalHandle>(null);
  const [details, setDetails] = useState<AboutDetails>();
  const [copied, setCopied] = useState(false);

  useImperativeHandle(ref, () => ({
    hide: () => modalRef.current?.hide(),
    show: next => {
      setDetails(next);
      setCopied(false);
      modalRef.current?.show();
    },
  }), []);

  return (
    <Modal ref={modalRef} skinny>
      {details && (
        <ModalBody className="pad">
          <div className="flex flex-col items-center text-center gap-[--padding-xs] pt-[--padding-md]">
            <img src={imgSrcCore} alt="" className="w-16 h-16" />
            <h2 className="m-0 text-[length:var(--font-size-xl)] font-semibold">{details.productName}</h2>
            <span className="text-[--hl]">{t('Version {version}', { version: details.version })}</span>
            <p className="flex items-center gap-1 m-0 mt-[--padding-xs]">
              {t('A 100% local and privacy-focused fork of Insomnia')}
              <Icon className="text-[--color-danger]" icon="heart" />
            </p>
          </div>
          <dl
            aria-label={t('Build details')}
            className="grid grid-cols-[max-content_1fr] gap-x-[--padding-md] gap-y-[--padding-xxs] m-0 mt-[--padding-md] p-[--padding-sm] rounded-md bg-[--hl-xxs] text-[length:var(--font-size-sm)]"
          >
            {details.rows.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-[--hl]">{label}</dt>
                <dd className="m-0 font-mono break-all select-text">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </ModalBody>
      )}
      <ModalFooter>
        <div className="flex w-full items-center gap-2">
          <button className="btn btn--clicky" onClick={() => window.main.openInBrowser(REPO_URL)}>
            <Icon icon={['fab', 'github']} /> GitHub
          </button>
          <span className="flex-1" />
          <button
            className="btn btn--clicky"
            onClick={() => {
              if (details) {
                window.clipboard.writeText(aboutText(details));
                setCopied(true);
              }
            }}
          >
            <Icon icon={copied ? 'check' : 'copy'} /> {copied ? t('Copied') : t('Copy details')}
          </button>
          <button className="btn btn--clicky" onClick={() => modalRef.current?.hide()}>
            {t('Close')}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
});
AboutModal.displayName = 'AboutModal';
