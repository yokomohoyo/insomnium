import React, { type FC, type SyntheticEvent, useCallback } from 'react';

import { type GrpcRequest, isGrpcRequest } from '../../../models/grpc-request';
import { isMcpRequest, type McpRequest } from '../../../models/mcp-request';
import { isRequest, type Request } from '../../../models/request';
import { isWebSocketRequest, type WebSocketRequest } from '../../../models/websocket-request';
import { requestDisplayName } from '../../utils/request-name';
import { getMethodShortHand } from '../tags/method-tag';

interface Props {
  handleSetItemSelected: (...args: any[]) => any;
  isSelected: boolean;
  request: Request | WebSocketRequest | GrpcRequest | McpRequest;
}

export const RequestRow: FC<Props> = ({
  handleSetItemSelected,
  request,
  isSelected,
}) => {
  const onChange = useCallback((event: SyntheticEvent<HTMLInputElement>) => {
    handleSetItemSelected(request._id, event?.currentTarget.checked);
  }, [handleSetItemSelected, request._id]);

  return (
    <li className="tree__row">
      <div className="tree__item tree__item--request">
        <div className="tree__item__checkbox tree__indent">
          <input type="checkbox" aria-label={requestDisplayName(request)} checked={isSelected} onChange={onChange} />
        </div>
        {/* on one line, labelled as the request tabs label them */}
        <button className="wide flex items-center gap-2 min-w-0">
          {isRequest(request) && <span className={`text-[0.65rem] http-method-${request.method}`}>{getMethodShortHand(request)}</span>}
          {isWebSocketRequest(request) && <span className="text-[0.65rem] info">WS</span>}
          {isMcpRequest(request) && <span className="text-[0.65rem] success">MCP</span>}
          {isGrpcRequest(request) && <span className="text-[0.65rem] method-grpc">gRPC</span>}
          <span className="truncate">{requestDisplayName(request)}</span>
        </button>
      </div>
    </li>
  );
};
