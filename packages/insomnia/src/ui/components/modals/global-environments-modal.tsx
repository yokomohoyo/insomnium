import { OverlayContainer } from '@react-aria/overlays';
import classnames from 'classnames';
import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRevalidator } from 'react-router-dom';

import { t } from '../../../common/i18n';
import * as models from '../../../models';
import type { Environment } from '../../../models/environment';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';
import { PromptButton } from '../base/prompt-button';
import { EnvironmentEditor, EnvironmentEditorHandle } from '../editors/environment-editor';

// The project's global environments (common/global-environments.ts): their
// variables, and the global sub environment this collection uses
export const GlobalEnvironmentsModal: FC<ModalProps & { projectName: string }> = ({ projectName, onHide }) => {
  const modalRef = useRef<ModalHandle>(null);
  const editorRef = useRef<EnvironmentEditorHandle>(null);
  const { projectId, workspaceId } = useParams() as { projectId: string; workspaceId: string };
  const { revalidate } = useRevalidator();
  const [base, setBase] = useState<Environment>();
  const [subEnvironments, setSubEnvironments] = useState<Environment[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const globalBase = await models.environment.getOrCreateForParentId(projectId);
    setBase(globalBase);
    setSubEnvironments(await models.environment.findByParentId(globalBase._id));
    setActiveId((await models.workspaceMeta.getOrCreateByParentId(workspaceId)).activeGlobalEnvironmentId);
    return globalBase;
  }, [projectId, workspaceId]);

  useEffect(() => {
    modalRef.current?.show();
    load().then(globalBase => setSelectedId(id => id || globalBase._id));
  }, [load]);

  const environments = base ? [base, ...subEnvironments] : [];
  const selected = environments.find(({ _id }) => _id === selectedId);

  const update = async (environment: Environment, patch: Partial<Environment>) => {
    await models.environment.update(environment, patch);
    await load();
    revalidate();
  };

  // the editor's value, kept when it's valid JSON
  const save = async () => {
    const value = editorRef.current?.isValid() ? editorRef.current.getValue() : null;
    const current = selected && await models.environment.getById(selected._id);
    if (current && value) {
      await update(current, { data: value.object, dataPropertyOrder: value.propertyOrder });
    }
  };

  const choose = async (id: string) => {
    if (editorRef.current && !editorRef.current.isValid()) {
      return;
    }
    await save();
    setSelectedId(id);
  };

  const use = async (environmentId: string | null) => {
    await models.workspaceMeta.updateByParentId(workspaceId, { activeGlobalEnvironmentId: environmentId });
    setActiveId(environmentId);
    revalidate();
  };

  const add = async () => {
    if (!base) {
      return;
    }
    await save();
    const created = await models.environment.create({ parentId: base._id, name: 'New Global Environment' });
    await load();
    setSelectedId(created._id);
  };

  const remove = async (environment: Environment) => {
    await models.environment.remove(environment);
    if (activeId === environment._id) {
      await use(null);
    }
    await load();
    setSelectedId(base?._id);
    revalidate();
  };

  const close = async () => {
    await save();
    modalRef.current?.hide();
  };

  return (
    <OverlayContainer>
      <Modal ref={modalRef} wide tall onHide={onHide}>
        <ModalHeader>{t('Global Environments')}</ModalHeader>
        <ModalBody noScroll className="env-modal">
          <div className="env-modal__sidebar">
            <ul aria-label={t('Global environments')} className="list-none m-0 p-0">
              {environments.map(environment => (
                <li
                  key={environment._id}
                  className={classnames('env-modal__sidebar-item', { 'env-modal__sidebar-item--active': environment._id === selectedId })}
                >
                  <button onClick={() => choose(environment._id)}>
                    {environment === base ? t('Global Base Environment') : environment.name}
                    {environment._id === activeId && <span className="faint space-left">{t('(in use)')}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn btn--compact" onClick={add}>
              <i className="fa fa-plus space-right" /> {t('Add Sub Environment')}
            </button>
          </div>
          <div className="env-modal__main">
            <div className="env-modal__main__header">
              {selected && selected !== base ? (
                <input
                  key={selected._id}
                  aria-label={t('Environment name')}
                  className="wide"
                  defaultValue={selected.name}
                  onBlur={event => event.currentTarget.value.trim() && event.currentTarget.value !== selected.name && update(selected, { name: event.currentTarget.value.trim() })}
                />
              ) : (
                <h1>{t('Global Base Environment')}</h1>
              )}
              {selected && selected !== base && (
                <>
                  <button className="btn btn--clicky space-left" disabled={selected._id === activeId} onClick={() => use(selected._id)}>
                    {t('Use in This Collection')}
                  </button>
                  <PromptButton className="btn btn--clicky space-left" onClick={() => remove(selected)}>
                    <i className="fa fa-trash-o" />
                  </PromptButton>
                </>
              )}
            </div>
            {/* the main grid's second row: the note, then the editor filling the rest */}
            <div className="flex flex-col min-h-0 h-full">
              <p className="faint txt-sm pad-left pad-right">
                {selected === base
                  ? t("Variables for every collection in {project}. A collection's own environments override them.", { project: projectName })
                  : t('Over the global base environment, for the collections that use it.')}
                {activeId && selected === base && (
                  <button className="btn btn--super-compact space-left" onClick={() => use(null)}>{t('Use No Global Sub Environment')}</button>
                )}
              </p>
              <div className="env-modal__editor flex-1 min-h-0" style={{ height: 'auto' }}>
                {selected && (
                  <EnvironmentEditor
                    ref={editorRef}
                    key={selected._id}
                    environmentInfo={{ object: selected.data, propertyOrder: selected.dataPropertyOrder }}
                    onBlur={save}
                  />
                )}
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button className="btn" onClick={close}>
            {t('Close')}
          </button>
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
