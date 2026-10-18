import React, { useEffect, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';

import { type DescribedRequest, parseRequestReply, requestPrompt } from '../../../common/ai-prompts';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// A new request from a description, written by the AI assistant's model
export const DescribeRequestModal = ({ onHide, onCreate, endpoint, model, variables }: ModalProps & {
  onCreate: (request: DescribedRequest) => void;
  endpoint: string;
  model: string;
  // the names of the collection's variables, which the model may use
  variables: string[];
}) => {
  const modalRef = useRef<ModalHandle>(null);
  const [description, setDescription] = useState('');
  const [isWriting, setWriting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    modalRef.current?.show();
  }, []);

  const write = async () => {
    setWriting(true);
    setError('');
    try {
      const reply = await window.main.ai.chat({ messages: requestPrompt(description, variables) });
      onCreate(parseRequestReply(reply));
      modalRef.current?.hide();
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
    setWriting(false);
  };

  return (
    <OverlayContainer onClick={e => e.stopPropagation()}>
      <Modal ref={modalRef} onHide={onHide}>
        <ModalHeader>New Request from a Description</ModalHeader>
        <ModalBody className="pad">
          <div className="form-control form-control--outlined">
            <label>
              Describe the request
              <textarea
                rows={4}
                autoFocus
                placeholder="Create an order for two of SKU A-1 on the shop API, as JSON, with my token"
                value={description}
                onChange={event => setDescription(event.currentTarget.value)}
                onKeyDown={event => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && description.trim() && !isWriting) {
                    write();
                  }
                }}
              />
            </label>
          </div>
          <p className="txt-sm faint">
            Sent to {host(endpoint)} ({model}): this description, and the names of this collection&apos;s variables{variables.length ? ` (${variables.length})` : ''}, not their values.
          </p>
          {error && <p className="notice error selectable" data-testid="describe-request-error">{error}</p>}
        </ModalBody>
        <ModalFooter>
          <div>
            <button className="btn" onClick={() => modalRef.current?.hide()}>
              Cancel
            </button>
            <button className="btn" disabled={!description.trim() || isWriting} onClick={write}>
              {isWriting && <i className="fa fa-spinner fa-spin space-right" />}
              Create
            </button>
          </div>
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
