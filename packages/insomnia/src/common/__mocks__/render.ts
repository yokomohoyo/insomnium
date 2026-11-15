import { jest } from '@jest/globals';

import * as renderOriginal from '../render';

const _render = jest.requireActual('../render') as typeof renderOriginal;
_render.getRenderedGrpcRequest = jest.fn<typeof renderOriginal.getRenderedGrpcRequest>();
_render.getRenderedGrpcRequestMessage = jest.fn<typeof renderOriginal.getRenderedGrpcRequestMessage>();

// WARNING: changing this to `export default` will break the mock and be incredibly hard to debug. Ask me how I know.
module.exports = _render;
