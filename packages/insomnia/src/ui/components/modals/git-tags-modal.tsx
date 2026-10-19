import React, { FC, useEffect, useRef } from 'react';
import { OverlayContainer } from 'react-aria';
import { useFetcher, useParams } from 'react-router-dom';

import { t } from '../../../common/i18n';
import { GitTagResult, GitTagsLoaderData } from '../../routes/git-actions';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';
import { PromptButton } from '../base/prompt-button';
import { showAlert } from '.';

// The repository's tags: new ones go on the current commit, and are pushed
// one at a time, as git push origin <tag> does.
export const GitTagsModal: FC<ModalProps> = ({ onHide }) => {
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const modalRef = useRef<ModalHandle>(null);
  const action = `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/tags`;
  const tagsFetcher = useFetcher<GitTagsLoaderData>();
  const tagFetcher = useFetcher<GitTagResult>();

  useEffect(() => {
    modalRef.current?.show();
  }, []);
  useEffect(() => {
    if (tagsFetcher.state === 'idle' && !tagsFetcher.data) {
      tagsFetcher.load(action);
    }
  }, [action, tagsFetcher]);
  useEffect(() => {
    if (tagFetcher.state !== 'idle' || !tagFetcher.data) {
      return;
    }
    if (tagFetcher.data.errors?.length) {
      showAlert({ title: t('Tag Failed'), message: tagFetcher.data.errors.join('\n') });
    }
    tagsFetcher.load(action);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once a tag action is done
  }, [tagFetcher.state, tagFetcher.data]);

  const { tags, head, hasRemote } = tagsFetcher.data || { tags: [], head: '', hasRemote: false };
  const submit = (fields: Record<string, string>) => tagFetcher.submit(fields, { action, method: 'post' });

  return (
    <OverlayContainer>
      <Modal ref={modalRef} onHide={onHide}>
        <ModalHeader><i className="fa fa-tags space-right" />{t('Tags')}</ModalHeader>
        <ModalBody className="pad">
          <tagFetcher.Form method="post" action={action} data-testid="git-tag-form">
            <input type="hidden" name="intent" value="create" />
            <div className="form-row">
              <div className="form-control form-control--outlined">
                <label>
                  {t('New Tag')}
                  <input type="text" autoFocus name="name" required placeholder="v1.0.0" />
                </label>
              </div>
              <div className="form-control form-control--outlined">
                <label>
                  {t('Message')} <span className="faint">{t('(optional: makes it annotated)')}</span>
                  <input type="text" name="message" placeholder={t('The first release')} />
                </label>
              </div>
              <div className="form-control form-control--no-label width-auto">
                <button disabled={tagFetcher.state !== 'idle' || !head} type="submit" className="btn btn--clicky">
                  <i className="fa fa-plus space-right" /> {t('Tag {commit}', { commit: head.slice(0, 7) })}
                </button>
              </div>
            </div>
          </tagFetcher.Form>

          <div className="pad-top">
            <table className="table--fancy table--outlined">
              <thead>
                <tr>
                  <th className="text-left">{t('Tag')}</th>
                  <th className="text-left">{t('Commit')}</th>
                  <th className="text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {tags.length === 0 && (
                  <tr><td colSpan={3} className="faint">{tagsFetcher.state === 'idle' ? t('No tags yet') : t('Loading…')}</td></tr>
                )}
                {tags.map(tag => (
                  <tr key={tag.name} data-testid="git-tag">
                    <td>
                      <strong>{tag.name}</strong>
                      {tag.message && <div className="txt-sm faint">{tag.message}</div>}
                    </td>
                    <td className="monospace txt-sm">{tag.oid.slice(0, 7)}{tag.oid === head ? <span className="faint"> {t('(current)')}</span> : null}</td>
                    <td className="text-right no-wrap">
                      {hasRemote && (
                        <button className="btn btn--micro btn--outlined space-left" onClick={() => submit({ intent: 'push', name: tag.name })}>
                          {t('Push')}
                        </button>
                      )}
                      <PromptButton
                        className="btn btn--micro btn--outlined space-left"
                        doneMessage={t('Deleted')}
                        onClick={() => submit({ intent: 'delete', name: tag.name })}
                      >
                        {t('Delete')}
                      </PromptButton>
                      {hasRemote && (
                        <PromptButton
                          className="btn btn--micro btn--outlined space-left"
                          doneMessage={t('Deleted')}
                          onClick={() => submit({ intent: 'delete', name: tag.name, remote: 'true' })}
                        >
                          {t('Delete Here and on the Remote')}
                        </PromptButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ModalBody>
        <ModalFooter>
          <div>
            <button className="btn" onClick={() => modalRef.current?.hide()}>
              {t('Done')}
            </button>
          </div>
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
