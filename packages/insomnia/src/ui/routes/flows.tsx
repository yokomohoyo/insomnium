import classnames from 'classnames';
import React, { FC, Suspense } from 'react';
import { ActionFunction, LoaderFunction, redirect, Route, Routes, useFetcher, useLoaderData, useNavigate, useParams, useRouteLoaderData } from 'react-router-dom';

import { database as db } from '../../common/database';
import { t } from '../../common/i18n';
import * as models from '../../models';
import type { Flow } from '../../models/flow';
import { listRunnableRequests } from '../../network/runner';
import { guard } from '../../utils/guard';
import { BackToRequests } from '../components/back-to-requests';
import { Dropdown, DropdownButton, DropdownItem, ItemContent } from '../components/base/dropdown';
import { ErrorBoundary } from '../components/error-boundary';
import { FlowEditor } from '../components/flows/flow-editor';
import { showPrompt } from '../components/modals';
import { SidebarLayout } from '../components/sidebar-layout';
import { Button } from '../components/themed-button';

// a request a flow can send: the collection's HTTP requests, in the sidebar's order
export interface FlowRequest {
  _id: string;
  name: string;
  method: string;
  // the folders it's in, outermost first
  folders: string[];
}

export interface FlowsLoaderData {
  flows: Flow[];
  requests: FlowRequest[];
}

export const loader: LoaderFunction = async ({ params }): Promise<FlowsLoaderData> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  const flows = (await models.flow.findByParentId(workspaceId)).sort((a, b) => a.created - b.created);
  const requests = (await listRunnableRequests(workspaceId)).map(({ request, folders }) => ({ _id: request._id, name: request.name, method: request.method, folders }));
  return { flows, requests };
};

const flowsPath = ({ organizationId, projectId, workspaceId }: Record<string, string | undefined>) =>
  `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/flows`;

export const createFlowAction: ActionFunction = async ({ request, params }) => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  const name = (await request.formData()).get('name');
  guard(typeof name === 'string', 'Name is required');
  const flow = await models.flow.create({ parentId: workspaceId, name: name.trim() || t('New Flow') });
  return redirect(`${flowsPath(params)}/${flow._id}`);
};

export const renameFlowAction: ActionFunction = async ({ request, params }) => {
  const flow = await models.flow.getById(params.flowId || '');
  guard(flow, 'Flow not found');
  const name = (await request.formData()).get('name');
  guard(typeof name === 'string' && name.trim(), 'Name is required');
  await models.flow.update(flow, { name: name.trim() });
  return null;
};

export const duplicateFlowAction: ActionFunction = async ({ params }) => {
  const flow = await models.flow.getById(params.flowId || '');
  guard(flow, 'Flow not found');
  const copy = await db.duplicate(flow, { name: t('{name} (Copy)', { name: flow.name }) });
  return redirect(`${flowsPath(params)}/${copy._id}`);
};

export const deleteFlowAction: ActionFunction = async ({ request, params }) => {
  const flow = await models.flow.getById(params.flowId || '');
  guard(flow, 'Flow not found');
  // the flow open in the window, which goes with it if it's this one
  const open = (await request.formData()).get('open');
  await models.flow.remove(flow);
  return open === flow._id ? redirect(flowsPath(params)) : null;
};

const FlowPane: FC = () => {
  // rendered by the page's <Routes>, which aren't the data router's: the list is the flows route's
  const { flows, requests } = useRouteLoaderData('flows') as FlowsLoaderData;
  const { flowId } = useParams() as { flowId: string };
  const flow = flows.find(candidate => candidate._id === flowId);
  if (!flow) {
    return <div className="pad faint">{t('This flow is gone: choose another.')}</div>;
  }
  // a flow of its own each time: the editor keeps the graph it's changing
  return <FlowEditor key={flow._id} flow={flow} requests={requests} />;
};

const FlowsRoute: FC = () => {
  const { flows } = useLoaderData() as FlowsLoaderData;
  const params = useParams() as { organizationId: string; projectId: string; workspaceId: string; flowId?: string; '*'?: string };
  // a flow's own route (its actions') matches before the splat does
  const selectedId = params.flowId || params['*']?.split('/')[0];
  const base = flowsPath(params);
  const navigate = useNavigate();
  const createFetcher = useFetcher();
  const actionFetcher = useFetcher();

  const newFlow = () => showPrompt({
    title: t('New Flow'),
    defaultValue: t('New Flow'),
    submitName: t('Create Flow'),
    label: t('Name'),
    selectText: true,
    onComplete: name => createFetcher.submit({ name }, { method: 'post', action: `${base}/new` }),
  });

  return (
    <SidebarLayout
      renderPageSidebar={
        <ErrorBoundary showAlert>
          <div className="flex flex-col h-full overflow-hidden">
            <BackToRequests />
            <div className="pad-sm">
              <Button variant="outlined" onClick={newFlow}>{t('New Flow')}</Button>
            </div>
            <ul aria-label={t('Flows')} className="list-none m-0 p-0 overflow-y-auto">
              {flows.map(flow => (
                <li
                  key={flow._id}
                  className={classnames('flex items-center justify-between gap-1 px-[--padding-sm] hover:bg-[--hl-xs]', { 'bg-[--hl-sm]': flow._id === selectedId })}
                >
                  <button
                    className="flex-1 text-left truncate py-[--padding-xs]"
                    aria-current={flow._id === selectedId ? 'page' : undefined}
                    onClick={() => navigate(`${base}/${flow._id}`)}
                  >
                    {flow.name}
                  </button>
                  <Dropdown
                    aria-label={t('Flow Actions')}
                    triggerButton={<DropdownButton aria-label={t('Flow Actions')}><i className="fa fa-caret-down" /></DropdownButton>}
                  >
                    <DropdownItem aria-label={t('Rename')}>
                      <ItemContent
                        label={t('Rename')}
                        icon="edit"
                        onClick={() => showPrompt({
                          title: t('Rename Flow'),
                          defaultValue: flow.name,
                          submitName: t('Rename'),
                          label: t('Name'),
                          selectText: true,
                          onComplete: name => actionFetcher.submit({ name }, { method: 'post', action: `${base}/${flow._id}/rename` }),
                        })}
                      />
                    </DropdownItem>
                    <DropdownItem aria-label={t('Duplicate')}>
                      <ItemContent
                        label={t('Duplicate')}
                        icon="copy"
                        onClick={() => actionFetcher.submit({}, { method: 'post', action: `${base}/${flow._id}/duplicate` })}
                      />
                    </DropdownItem>
                    <DropdownItem aria-label={t('Delete')}>
                      <ItemContent
                        label={t('Delete')}
                        icon="trash-o"
                        withPrompt
                        className="danger"
                        onClick={() => actionFetcher.submit({ open: selectedId || '' }, { method: 'post', action: `${base}/${flow._id}/delete` })}
                      />
                    </DropdownItem>
                  </Dropdown>
                </li>
              ))}
            </ul>
          </div>
        </ErrorBoundary>
      }
      renderPaneOne={
        <Routes>
          <Route
            path=":flowId/*"
            element={
              <Suspense>
                <FlowPane />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <div className="pad flex flex-col items-start gap-[--padding-md] max-w-[40rem]">
                <h2 className="m-0">{t('Flows')}</h2>
                <p className="m-0">
                  {t("A flow sends the collection's requests in the order you draw them, with conditions on their responses, variables taken from them for the requests after, and delays.")}
                </p>
                <Button variant="outlined" onClick={newFlow}>{t('New Flow')}</Button>
              </div>
            }
          />
        </Routes>
      }
    />
  );
};

export default FlowsRoute;
