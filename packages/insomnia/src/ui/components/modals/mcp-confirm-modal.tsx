import React, { type FC, useEffect, useRef, useState } from 'react';

import type { InAppQuestion } from '../../../main/mcp/ask-in-app';
import { Modal, type ModalHandle } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';

// What an MCP client needs the user's yes for (main/mcp/ask-in-app.ts): running
// unit tests or security tests, a Git commit, pull or push, an MCP request's
// command. The main process asks, this shows the question, and only a click
// on the yes button is a yes: closing it any other way is a no, as is the
// client giving up on its request. One question at a time, in the order asked.
export const McpConfirmModal: FC = () => {
  const modalRef = useRef<ModalHandle>(null);
  const [questions, setQuestions] = useState<InAppQuestion[]>([]);
  const question = questions[0];
  // the question on show, until it has been answered
  const asking = useRef<string>();

  useEffect(() => {
    const unsubscribeAsk = window.main.on('mcp.confirm', (_, asked: InAppQuestion) => {
      setQuestions(waiting => [...waiting, asked]);
    });
    // the client gave up on its request: nothing to answer any more
    const unsubscribeCancel = window.main.on('mcp.confirm.cancel', (_, id: string) => {
      setQuestions(waiting => waiting.filter(asked => asked.id !== id));
    });
    return () => {
      unsubscribeAsk();
      unsubscribeCancel();
    };
  }, []);

  useEffect(() => {
    if (question) {
      asking.current = question.id;
      window.main.mcpConfirmShown(question.id);
      modalRef.current?.show();
    } else {
      asking.current = undefined;
      modalRef.current?.hide();
    }
  }, [question]);

  const answer = (allowed: boolean) => {
    const id = asking.current;
    if (!id) {
      return;
    }
    asking.current = undefined;
    window.main.answerMcpConfirm(id, allowed);
    setQuestions(waiting => waiting.filter(asked => asked.id !== id));
  };

  return (
    // (closed with Escape, the × or a click outside: a no)
    <Modal ref={modalRef} onHide={() => answer(false)}>
      <ModalHeader>
        {question?.type === 'warning' ? <i className="fa fa-triangle-exclamation warning space-right" aria-hidden /> : null}
        {question?.title}
      </ModalHeader>
      <ModalBody className="wide pad">
        <p className="m-0"><strong>{question?.message}</strong></p>
        {question?.detail ? <p className="selectable whitespace-pre-wrap break-words margin-top-sm" data-testid="mcp-confirm-detail">{question.detail}</p> : null}
      </ModalBody>
      <ModalFooter>
        <div>
          {/* the default: Enter on a dialog that has just opened declines */}
          <button className="btn" autoFocus onClick={() => answer(false)}>
            {question?.no}
          </button>
          <button className="btn" onClick={() => answer(true)}>
            {question?.yes}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};
