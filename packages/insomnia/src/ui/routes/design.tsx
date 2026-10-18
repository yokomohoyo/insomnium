import type { IRuleResult } from '@stoplight/spectral-core';
import CodeMirror from 'codemirror';
import path from 'path';
import React, { createRef, FC, Fragment, useCallback, useEffect, useMemo } from 'react';
import {
  LoaderFunction,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useToggle } from 'react-use';
import styled from 'styled-components';
import { SwaggerUIBundle } from 'swagger-ui-dist';

import { parseApiSpec } from '../../common/api-specs';
import { ACTIVITY_DEBUG, ACTIVITY_SPEC } from '../../common/constants';
import { debounce } from '../../common/misc';
import { selectFileOrFolder } from '../../common/select-file-or-folder';
import { RulesetSource, spectralRulesetFor } from '../../common/spectral-ruleset-path';
import { ApiSpec } from '../../models/api-spec';
import * as models from '../../models/index';
import { guard } from '../../utils/guard';
import {
  CodeEditor,
  CodeEditorHandle,
} from '../components/codemirror/code-editor';
import { Dropdown, DropdownButton, DropdownItem, ItemContent } from '../components/base/dropdown';
import { DesignEmptyState } from '../components/design-empty-state';
import { showAlert } from '../components/modals';

import { ErrorBoundary } from '../components/error-boundary';
import { Notice, NoticeTable } from '../components/notice-table';
import { SidebarLayout } from '../components/sidebar-layout';
import { SpecEditorSidebar } from '../components/spec-editor/spec-editor-sidebar';
import {
  useActiveApiSpecSyncVCSVersion,
  useGitVCSVersion,
} from '../hooks/use-vcs-version';
import { WorkspaceSyncDropdown } from '../components/dropdowns/workspace-sync-dropdown';
const EmptySpaceHelper = styled.div({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '2em',
  textAlign: 'center',
  opacity: 'calc(var(--opacity-subtle) * 0.8)',
});

export const Toolbar = styled.div({
  boxSizing: 'content-box',
  position: 'sticky',
  top: 0,
  zIndex: 1,
  backgroundColor: 'var(--color-bg)',
  display: 'flex',
  justifyContent: 'space-between',
  flexDirection: 'row',
  borderTop: '1px solid var(--hl-md)',
  height: 'var(--line-height-sm)',
  fontSize: 'var(--font-size-sm)',
  '& > button': {
    color: 'var(--hl)',
    padding: 'var(--padding-xs) var(--padding-xs)',
    height: '100%',
  },
});

const RulesetLabel = styled.div({
  display: 'flex',
  alignItems: 'center',
  padding: 'var(--padding-md)',
  height: '100%',
  boxSizing: 'border-box',
  gap: 'var(--padding-sm)',
  color: 'var(--hl)',
});

interface LoaderData {
  lintMessages: LintMessage[];
  apiSpec: ApiSpec;
  rulesetPath: string;
  rulesetSource: RulesetSource;
}

export const loader: LoaderFunction = async ({
  params,
}): Promise<LoaderData> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  const apiSpec = await models.apiSpec.getByParentId(workspaceId);
  guard(apiSpec, 'API spec not found');
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  let lintMessages: LintMessage[] = [];
  const { rulesetPath, source: rulesetSource } = await spectralRulesetFor(workspaceId);

  if (apiSpec.contents && apiSpec.contents.length !== 0) {
    try {
      lintMessages = (await window.main.spectralRun({
        contents: apiSpec.contents,
        rulesetPath,
      }))
        .map(({ severity, code, message, range }) => ({
          type: (['error', 'warning'][severity] ?? 'info') as Notice['type'],
          message: `${code} ${message}`,
          line: range.start.line,
          // Attach range that will be returned to our click handler
          range,
        }));
    } catch (e) {
      console.log('Error linting spec', e);
    }
  }

  return {
    lintMessages,
    apiSpec,
    rulesetPath,
    rulesetSource,
  };
};

const SwaggerUIDiv = ({ text }: { text: string }) => {
  useEffect(() => {
    let spec = {};
    try {
      spec = parseApiSpec(text).contents || {};
    } catch (err) { }
    SwaggerUIBundle({ spec, dom_id: '#swagger-ui' });
  }, [text]);
  return <div
    id="swagger-ui"
    style={{
      overflowY: 'auto',
      height: '100%',
      background: '#FFF',
    }}
  />;
};

interface LintMessage extends Notice {
  range: IRuleResult['range'];
}

const Design: FC = () => {
  const { organizationId, projectId, workspaceId } = useParams() as {
    organizationId: string;
    projectId: string;
    workspaceId: string;
  };
  const { apiSpec, lintMessages, rulesetPath, rulesetSource } = useLoaderData() as LoaderData;
  const editor = createRef<CodeEditorHandle>();

  const updateApiSpecFetcher = useFetcher();
  const generateRequestCollectionFetcher = useFetcher();
  // a ruleset file for this document, kept on this computer
  const rulesetFetcher = useFetcher();
  const setRulesetPath = (spectralRulesetPath: string) => rulesetFetcher.submit(
    { spectralRulesetPath },
    { action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/update-meta`, method: 'post', encType: 'application/json' },
  );
  const chooseRuleset = async () => {
    const { canceled, filePath } = await selectFileOrFolder({ itemTypes: ['file'], extensions: ['yaml', 'yml', 'json'] });
    if (!canceled && filePath) {
      setRulesetPath(filePath);
    }
  };
  // once generated: what changed, when it changed requests made before, and the requests
  const navigate = useNavigate();
  const generated = generateRequestCollectionFetcher.data as { summary: string } | undefined;
  useEffect(() => {
    if (generateRequestCollectionFetcher.state !== 'idle' || !generated) {
      return;
    }
    if (generated.summary) {
      showAlert({ title: 'Request Collection Updated', message: generated.summary });
    }
    navigate(`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${ACTIVITY_DEBUG}`);
  }, [generateRequestCollectionFetcher.state, generated, navigate, organizationId, projectId, workspaceId]);
  const [showRightPane, toggleRightPane] = useToggle(true);

  useEffect(() => {
    CodeMirror.registerHelper('lint', 'openapi', async (contents: string) => {
      const diagnostics = await window.main.spectralRun({
        contents,
        rulesetPath,
      });

      return diagnostics.map(result => ({
        from: CodeMirror.Pos(result.range.start.line, result.range.start.character),
        to: CodeMirror.Pos(result.range.end.line, result.range.end.character),
        message: result.message,
        severity: ['error', 'warning'][result.severity] ?? 'info',
      }));
    });
  }, [rulesetPath]);

  const onCodeEditorChange = useMemo(() => {
    const handler = async (contents: string) => {
      updateApiSpecFetcher.submit(
        {
          contents: contents,
        },
        {
          action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${ACTIVITY_SPEC}/update`,
          method: 'post',
        }
      );
    };

    return debounce(handler, 500);
  }, [organizationId, projectId, updateApiSpecFetcher, workspaceId]);

  const handleScrollToSelection = useCallback(
    (chStart: number, chEnd: number, lineStart: number, lineEnd: number) => {
      if (!editor.current) {
        return;
      }
      editor.current.scrollToSelection(chStart, chEnd, lineStart, lineEnd);
    },
    [editor]
  );

  const handleScrollToLintMessage = useCallback(
    (notice: LintMessage) => {
      if (!editor.current) {
        return;
      }
      if (!notice.range) {
        return;
      }
      const { start, end } = notice.range;
      editor.current.scrollToSelection(
        start.character,
        end.character,
        start.line,
        end.line
      );
    },
    [editor]
  );

  const gitVersion = useGitVCSVersion();
  const syncVersion = useActiveApiSpecSyncVCSVersion();
  const uniquenessKey = `${apiSpec?._id}::${apiSpec?.created}::${gitVersion}::${syncVersion}`;

  return (
    <SidebarLayout
      renderPageSidebar={
        apiSpec.contents ? (
          <ErrorBoundary
            invalidationKey={apiSpec.contents}
            renderError={() => (
              <div className="text-left margin pad">
                <h4>
                  An error occurred while trying to render your spec's
                  navigation.
                </h4>
                <p>
                  This navigation will automatically refresh, once you have a
                  valid specification that can be rendered.
                </p>
              </div>
            )}
          >
            <SpecEditorSidebar
              apiSpec={apiSpec}
              handleSetSelection={handleScrollToSelection}
            />
            <div
              style={{
                gridRowStart: 6,
              }}
            >
              <WorkspaceSyncDropdown />
            </div>
          </ErrorBoundary>
        ) : (
          <Fragment>
            <EmptySpaceHelper>A spec navigator will render here</EmptySpaceHelper>
            <div
              style={{
                gridRowStart: 6,
              }}
            >
                <WorkspaceSyncDropdown />
            </div>
          </Fragment>
        )
      }
      renderPaneTwo={showRightPane && <SwaggerUIDiv text={apiSpec.contents} />}
      renderPaneOne={
        apiSpec ? (
          <div className="column tall theme--pane__body">
            <div className="tall relative overflow-hidden">
              <CodeEditor
                id="spec-editor"
                key={uniquenessKey}
                showPrettifyButton
                ref={editor}
                lintOptions={{ delay: 1000 }}
                mode="openapi"
                defaultValue={apiSpec.contents || ''}
                onChange={onCodeEditorChange}
                uniquenessKey={uniquenessKey}
              />
              {apiSpec.contents ? null : (
                <DesignEmptyState
                  onImport={value => {
                    updateApiSpecFetcher.submit(
                      {
                        contents: value,
                        fromSync: 'true',
                      },
                      {
                        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${ACTIVITY_SPEC}/update`,
                        method: 'post',
                      }
                    );
                  }}
                />
              )}
            </div>
            {lintMessages.length > 0 && (
              <NoticeTable
                notices={lintMessages}
                onClick={handleScrollToLintMessage}
                toggleRightPane={toggleRightPane}
              />
            )}
            {apiSpec.contents ? (
              <Toolbar>
                <Dropdown
                  aria-label="Ruleset"
                  triggerButton={
                    <DropdownButton>
                      <RulesetLabel title={rulesetPath || 'The built-in OpenAPI rules'}>
                        <i className={rulesetSource === 'built-in' ? 'fa fa-file-circle-xmark' : 'fa fa-file-circle-check'} />
                        {rulesetSource === 'built-in' ? 'Ruleset: built-in' : `Ruleset: ${path.basename(rulesetPath)}${rulesetSource === 'git' ? ' (git)' : ''}`}
                      </RulesetLabel>
                    </DropdownButton>
                  }
                >
                  <DropdownItem aria-label="Choose a Ruleset File">
                    <ItemContent icon="file-circle-plus" label="Choose a Ruleset File…" onClick={chooseRuleset} />
                  </DropdownItem>
                  <DropdownItem aria-label="Clear the Chosen Ruleset">
                    <ItemContent
                      icon="xmark"
                      label={rulesetSource === 'chosen' ? 'Clear the Chosen Ruleset' : 'No Ruleset Chosen'}
                      isDisabled={rulesetSource !== 'chosen'}
                      onClick={() => setRulesetPath('')}
                    />
                  </DropdownItem>
                </Dropdown>
                <button
                  disabled={lintMessages.filter(message => message.type === 'error').length > 0 || generateRequestCollectionFetcher.state !== 'idle'}
                  className="btn btn--compact"
                  onClick={() => {
                    generateRequestCollectionFetcher.submit(
                      {},
                      {
                        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${ACTIVITY_SPEC}/generate-request-collection`,
                        method: 'post',
                      }
                    );
                  }}
                >
                  {generateRequestCollectionFetcher.state === 'loading' ? (
                    <i className="fa fa-spin fa-spinner" />
                  ) : (
                    <i className="fa fa-file-import" />
                  )} Generate Request Collection
                </button>
              </Toolbar>
            ) : null}
          </div>
        ) : null
      }
    />
  );
};

export default Design;
