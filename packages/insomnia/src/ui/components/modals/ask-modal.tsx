import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import { t } from '../../../common/i18n';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';
interface State {
  title: string;
  message: React.ReactNode;
  yesText: string;
  noText: string;
  onDone?: (success: boolean) => Promise<void>;
}
export interface AskModalOptions {
  title?: string;
  message: React.ReactNode;
  onDone?: (success: boolean) => Promise<void>;
  yesText?: string;
  noText?: string;
}
export interface AskModalHandle {
  show: (options: AskModalOptions) => void;
  hide: () => void;
}
export const AskModal = forwardRef<AskModalHandle, ModalProps>((_, ref) => {
  const modalRef = useRef<ModalHandle>(null);
  const [state, setState] = useState<State>({
    title: '',
    message: '',
    yesText: t('Yes'),
    noText: t('No'),
    onDone: async () => { },
  });

  useImperativeHandle(ref, () => ({
    hide: () => {
      modalRef.current?.hide();
    },
    show: ({ title, message, onDone, yesText, noText }) => {
      setState({
        title: title || t('Confirm'),
        message: message || t('No message provided'),
        yesText: yesText || t('Yes'),
        noText: noText || t('No'),
        onDone,
      });
      modalRef.current?.show();
    },
  }), []);
  const { message, title, yesText, noText, onDone } = state;
  return (
    <Modal ref={modalRef}>
      <ModalHeader>{title || t('Confirm?')}</ModalHeader>
      <ModalBody className="wide pad">{message}</ModalBody>
      <ModalFooter>
        <div>
          <button
            className="btn"
            onClick={() => {
              modalRef.current?.hide();
              onDone?.(false);
            }}
          >
            {noText}
          </button>
          <button
            className="btn"
            onClick={() => {
              modalRef.current?.hide();
              onDone?.(true);
            }}
          >
            {yesText}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
});
AskModal.displayName = 'AskModal';
