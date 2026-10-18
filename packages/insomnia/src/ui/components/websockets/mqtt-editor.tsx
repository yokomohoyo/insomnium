import React, { FC, useRef } from 'react';

import { WebSocketRequest } from '../../../models/websocket-request';
import { useRequestSetter } from '../../hooks/use-request';
import { HelpTooltip } from '../help-tooltip';

type Mqtt = NonNullable<WebSocketRequest['mqtt']>;

export const emptyMqtt = (): Mqtt => ({ enabled: false, clientId: '', username: '', password: '', keepalive: 30, subscriptions: '', topic: '', qos: 0, retain: false });

// MQTT for a WebSocket request (main/network/mqtt.ts): on, who to connect as,
// and the topics to subscribe to
export const MqttEditor: FC<{ request: WebSocketRequest; disabled: boolean }> = ({ request, disabled }) => {
  const patchRequest = useRequestSetter();
  // the latest, so an edit to one field doesn't undo a quick edit to another
  const latest = useRef<Mqtt>({ ...emptyMqtt(), ...request.mqtt });
  const update = (patch: Partial<Mqtt>) => {
    latest.current = { ...latest.current, ...patch };
    patchRequest(request._id, { mqtt: latest.current });
  };

  return (
    <div className="flex flex-col gap-2 pad-sm">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Use MQTT"
            defaultChecked={latest.current.enabled}
            disabled={disabled}
            onChange={event => update({ enabled: event.currentTarget.checked })}
          />
          Use MQTT
        </label>
        <HelpTooltip>
          Speaks MQTT 3.1.1 over the WebSocket, to a broker&apos;s WebSocket listener, such as ws://localhost:8080 for Mosquitto&apos;s or ws://broker.hivemq.com:8000/mqtt. Connecting subscribes to the topics below; Send publishes the message to the topic by it. Deliveries show in the events as &quot;topic: payload&quot;.
        </HelpTooltip>
      </div>
      <label className="txt-sm">
        Client ID
        <input
          type="text"
          aria-label="MQTT client ID"
          className="w-full"
          defaultValue={latest.current.clientId}
          placeholder="A new one each connection"
          disabled={disabled}
          onChange={event => update({ clientId: event.currentTarget.value })}
        />
      </label>
      <div className="flex gap-2">
        <label className="txt-sm flex-1">
          User name
          <input type="text" aria-label="MQTT user name" className="w-full" defaultValue={latest.current.username} disabled={disabled} onChange={event => update({ username: event.currentTarget.value })} />
        </label>
        <label className="txt-sm flex-1">
          Password
          <input type="password" aria-label="MQTT password" className="w-full" defaultValue={latest.current.password} placeholder="{{ mqtt_password }}" disabled={disabled} onChange={event => update({ password: event.currentTarget.value })} />
        </label>
        <label className="txt-sm">
          Keep alive (s)
          <input type="number" aria-label="MQTT keep alive" min={0} max={65535} defaultValue={latest.current.keepalive} disabled={disabled} onChange={event => update({ keepalive: Math.max(0, Math.min(65535, Math.round(Number(event.currentTarget.value)) || 0)) })} />
        </label>
      </div>
      <label className="txt-sm">
        Subscribe to, a topic a line, with its QoS (0 or 1) after it
        <textarea
          aria-label="MQTT subscriptions"
          className="w-full monospace"
          rows={4}
          defaultValue={latest.current.subscriptions}
          placeholder={'sensors/+/temperature 1\nalerts/#'}
          disabled={disabled}
          onChange={event => update({ subscriptions: event.currentTarget.value })}
        />
      </label>
    </div>
  );
};
