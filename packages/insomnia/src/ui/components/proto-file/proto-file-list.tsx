import React, { FunctionComponent, useMemo, useState } from 'react';
import styled from 'styled-components';

import { ProtoDirectory } from '../../../models/proto-directory';
import type { ProtoFile } from '../../../models/proto-file';
import { ListGroup, ListGroupItem } from '../list-group';
import { Button } from '../themed-button';

export type SelectProtoFileHandler = (id: string) => void;
export type DeleteProtoFileHandler = (protofile: ProtoFile) => void;
export type DeleteProtoDirectoryHandler = (protoDirectory: ProtoDirectory) => void;
export type UpdateProtoFileHandler = (protofile: ProtoFile | ProtoDirectory) => Promise<void>;
export type RenameProtoFileHandler = (protoFile: ProtoFile, name?: string) => Promise<void>;
export const ProtoListItem = styled(ListGroupItem).attrs(() => ({
  className: 'row-spaced',
}))`
  button i.fa {
    font-size: var(--font-size-lg);
  }

  height: var(--line-height-sm);
`;

export interface ExpandedProtoDirectory {
  files: ProtoFile[];
  dir: ProtoDirectory | null;
  subDirs: ExpandedProtoDirectory[];
}
interface Props {
  protoDirectories: ExpandedProtoDirectory[];
  selectedId?: string;
  handleSelect: SelectProtoFileHandler;
  handleDelete: DeleteProtoFileHandler;
  handleUpdate: UpdateProtoFileHandler;
  handleDeleteDirectory: DeleteProtoDirectoryHandler;
}

const recursiveRender = (
  indent: number,
  { dir, files, subDirs }: ExpandedProtoDirectory,
  handleSelect: SelectProtoFileHandler,
  handleUpdate: UpdateProtoFileHandler,
  handleDelete: DeleteProtoFileHandler,
  handleDeleteDirectory: DeleteProtoDirectoryHandler,
  selectedId?: string,
): React.ReactNode => ([
  dir && (
    <ProtoListItem indentLevel={indent}>
      <span className="wide">
        <i className="fa fa-folder-open-o pad-right-sm" />
        {dir.name}
      </span>
      {indent === 0 && (
        <div className="row">
          <Button
            variant="text"
            title="Re-discover proto files"
            onClick={event => {
              event.stopPropagation();
              handleUpdate(dir);
            }}
          >
            <i className="fa fa-refresh" />
          </Button>
        </div>
      )}
      <Button
        variant="text"
        title="Delete Directory"
        onClick={event => {
          event.stopPropagation();
          handleDeleteDirectory(dir);
        }}
        bg="danger"
      >
        <i className="fa fa-trash-o" />
      </Button>
    </ProtoListItem>),
  ...files.map(f => (
    <ProtoListItem
      key={f._id}
      selectable
      isSelected={f._id === selectedId}
      onClick={() => handleSelect(f._id)}
      indentLevel={indent + 1}
    >
      <>
        <span className="wide">
          <i className="fa fa-file-o pad-right-sm" />
          {f.name}
        </span>
        <div className="row">
          <Button
            variant="text"
            title="Re-upload Proto File"
            onClick={event => {
              event.stopPropagation();
              handleUpdate(f);
            }}
            className="space-right"
          >
            <i className="fa fa-upload" />
          </Button>
          <Button
            variant="text"
            title="Delete Proto File"
            bg="danger"
            onClick={event => {
              event.stopPropagation();
              handleDelete(f);
            }}
          >
            <i className="fa fa-trash-o" />
          </Button>
        </div>
      </>
    </ProtoListItem>
  )),
  ...subDirs.map(sd => recursiveRender(
    indent + 1,
    sd,
    handleSelect,
    handleUpdate,
    handleDelete,
    handleDeleteDirectory,
    selectedId,
  ))]);

// Prune the tree to only entries whose file name (or path segment) contains
// the query. Empty subtrees disappear; matching files surface alongside their
// ancestor folders for context.
function filterTree(node: ExpandedProtoDirectory, q: string): ExpandedProtoDirectory | null {
  const files = node.files.filter(f => f.name.toLowerCase().includes(q));
  const subDirs = node.subDirs
    .map(sd => filterTree(sd, q))
    .filter((sd): sd is ExpandedProtoDirectory => sd !== null);
  // Match the directory itself by name too so a folder query keeps its contents.
  const dirNameMatch = node.dir?.name.toLowerCase().includes(q);
  if (files.length === 0 && subDirs.length === 0 && !dirNameMatch) {
    return null;
  }
  // If the directory name matched, keep ALL its files/subdirs for context.
  return dirNameMatch
    ? node
    : { dir: node.dir, files, subDirs };
}

export const ProtoFileList: FunctionComponent<Props> = props => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return props.protoDirectories;
    return props.protoDirectories
      .map(d => filterTree(d, q))
      .filter((d): d is ExpandedProtoDirectory => d !== null);
  }, [props.protoDirectories, q]);

  return (
    <>
      {props.protoDirectories.length > 0 && (
        <div className="pad-sm">
          <input
            type="search"
            className="form-control"
            placeholder="Filter proto files..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      )}
      <ListGroup bordered>
        {!props.protoDirectories.length && (
          <ListGroupItem>No proto files exist for this workspace</ListGroupItem>
        )}
        {filtered.length === 0 && q && (
          <ListGroupItem>No matches for &quot;{query}&quot;</ListGroupItem>
        )}
        {filtered.map((dir, i) => (
          <React.Fragment key={dir.dir?._id ?? `__root_${i}`}>
            {recursiveRender(
              0,
              dir,
              props.handleSelect,
              props.handleUpdate,
              props.handleDelete,
              props.handleDeleteDirectory,
              props.selectedId
            )}
          </React.Fragment>
        ))}
      </ListGroup>
    </>
  );
};
