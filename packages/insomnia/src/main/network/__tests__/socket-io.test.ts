import { describe, expect, it } from '@jest/globals';

import { socketIoArgs, socketIoEvent, socketIoReplies, socketIoUrl } from '../socket-io';

describe('Socket.IO', () => {
  it("connects to the server's WebSocket transport", () => {
    expect(socketIoUrl('http://localhost:3000')).toBe('ws://localhost:3000/socket.io/?EIO=4&transport=websocket');
    expect(socketIoUrl('https://chat.example.com/?room=1')).toBe('wss://chat.example.com/socket.io/?room=1&EIO=4&transport=websocket');
    expect(socketIoUrl('ws://localhost:3000/custom/')).toBe('ws://localhost:3000/custom/?EIO=4&transport=websocket');
    expect(socketIoUrl('localhost:3000')).toBe('ws://localhost:3000/socket.io/?EIO=4&transport=websocket');
  });

  it('connects to the namespace once the transport opens, with the auth, and answers a ping', () => {
    const open = '0{"sid":"a","upgrades":[],"pingInterval":25000,"pingTimeout":20000}';
    expect(socketIoReplies(open, {})).toEqual(['40']);
    expect(socketIoReplies(open, { namespace: '/' })).toEqual(['40']);
    expect(socketIoReplies(open, { namespace: '/chat', auth: { token: 'abc' } })).toEqual(['40/chat,{"token":"abc"}']);
    expect(socketIoReplies(open, { namespace: 'chat' })).toEqual(['40/chat,']);
    expect(socketIoReplies('2', {})).toEqual(['3']);
    expect(socketIoReplies('42["news",1]', {})).toEqual([]);
    expect(socketIoReplies(Buffer.from('0'), {})).toEqual([]);
  });

  it('sends an event with its arguments', () => {
    expect(socketIoEvent('hello', [{ name: 'Rex' }])).toBe('42["hello",{"name":"Rex"}]');
    expect(socketIoEvent('hello', [1, 'two'], '/pets')).toBe('42/pets,["hello",1,"two"]');
    expect(socketIoArgs('[1, "two"]')).toEqual([1, 'two']);
    expect(socketIoArgs('{"a": 1}')).toEqual([{ a: 1 }]);
    expect(socketIoArgs('  ')).toEqual([]);
    expect(() => socketIoArgs('{ nope')).toThrow();
  });
});
