import React, { FC, useMemo } from 'react';
import styled from 'styled-components';
import YAML from 'yaml';
import YAMLSourceMap from 'yaml-source-map';

import { parseApiSpec } from '../../../common/api-specs';
import type { ApiSpec } from '../../../models/api-spec';

import { Sidebar } from './sidebar';

interface Props {
  apiSpec: ApiSpec;
  handleSetSelection: (chStart: number, chEnd: number, lineStart: number, lineEnd: number) => void;
}

const StyledSpecEditorSidebar = styled.div`
  overflow: hidden;
  overflow-y: auto;
`;

export const SpecEditorSidebar: FC<Props> = ({ apiSpec, handleSetSelection }) => {
  const onClick = (...itemPath: any[]): void => {
    const scrollPosition = { start: { line: 0, col: 0 }, end: { line: 0, col: 200 } };

    try {
      JSON.parse(apiSpec.contents);
      // Account for JSON (as string) line number shift
      scrollPosition.start.line = 1;
    } catch { }

    const sourceMap = new YAMLSourceMap();
    const specMap = sourceMap.index(
      YAML.parseDocument(apiSpec.contents, {
        keepCstNodes: true,
      }),
    );
    const itemMappedPosition = sourceMap.lookup(itemPath, specMap);
    if (itemMappedPosition) {
      scrollPosition.start.line += itemMappedPosition.start.line;
    }
    const isServersSection = itemPath[0] === 'servers';
    if (!isServersSection) {
      scrollPosition.start.line -= 1;
    }

    scrollPosition.end.line = scrollPosition.start.line;
    // NOTE: We're subtracting 1 from everything because YAML CST uses
    //   1-based indexing and we use 0-based.
    handleSetSelection(scrollPosition.start.col - 1, scrollPosition.end.col - 1, scrollPosition.start.line - 1, scrollPosition.end.line - 1);
  };

  // once per text, not every render, and JSON as JSON (YAML took 250 ms for 3 MB)
  const specJSON = useMemo(() => parseApiSpec(apiSpec.contents).contents ?? undefined, [apiSpec.contents]);

  return (
    <StyledSpecEditorSidebar>
      <Sidebar jsonData={specJSON} onClick={onClick} />
    </StyledSpecEditorSidebar>
  );
};
