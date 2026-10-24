import React, { FC } from 'react';

import { CONTENT_TYPE_JSON, CONTENT_TYPE_PLAINTEXT } from '../../../common/constants';
import { PAYLOAD_BASE64, PAYLOAD_HEX } from '../../../main/network/websocket-frames';
import { Dropdown, DropdownButton, DropdownItem, ItemContent } from '../base/dropdown';

interface Props {
  previewMode: string;
  onClick: (previewMode: string) => void;
}
export const WebSocketPreviewMode: FC<Props> = ({ previewMode, onClick }) => {
  return (
    <Dropdown
      aria-label="Websocket Preview Mode Dropdown"
      triggerButton={
        <DropdownButton className="tall">
          {{
            [CONTENT_TYPE_JSON]: 'JSON',
            [CONTENT_TYPE_PLAINTEXT]: 'Raw',
            [PAYLOAD_HEX]: 'Hex',
            [PAYLOAD_BASE64]: 'Base64',
          }[previewMode]}
          <i className="fa fa-caret-down space-left" />
        </DropdownButton>
      }
    >
      <DropdownItem aria-label='JSON'>
        <ItemContent
          label="JSON"
          onClick={() => onClick(CONTENT_TYPE_JSON)}
        />
      </DropdownItem>
      <DropdownItem aria-label='Raw'>
        <ItemContent
          label="Raw"
          onClick={() => onClick(CONTENT_TYPE_PLAINTEXT)}
        />
      </DropdownItem>
      {/* sent as a binary frame: the bytes the hex or base64 spells */}
      <DropdownItem aria-label='Hex (binary)'>
        <ItemContent
          label="Hex (binary)"
          onClick={() => onClick(PAYLOAD_HEX)}
        />
      </DropdownItem>
      <DropdownItem aria-label='Base64 (binary)'>
        <ItemContent
          label="Base64 (binary)"
          onClick={() => onClick(PAYLOAD_BASE64)}
        />
      </DropdownItem>
    </Dropdown>
  );
};
