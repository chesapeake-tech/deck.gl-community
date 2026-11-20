// Local prototype config: builds the example against LOCAL SOURCE of deck.gl and of the luma.gl
// temporal upscaler, through Vite aliases.
//
//   DECK_GL_SOURCE   path of a deck.gl checkout that has the `_temporal` prop
//   LUMA_GL_SOURCE   path of a luma.gl checkout that has `effects/temporal-upscale`
//
// The other luma.gl packages come from node_modules (the version that deck.gl depends on). The
// upscaler imports `@luma.gl/core` only, and `dedupe` binds that import to the same copy.

import {defineConfig} from 'vite';
import {resolve} from 'path';
import baseConfig from '../../vite.config.local.mjs';

const deckSource = process.env.DECK_GL_SOURCE;
const lumaSource = process.env.LUMA_GL_SOURCE;
if (!deckSource || !lumaSource) {
  throw new Error('Set DECK_GL_SOURCE and LUMA_GL_SOURCE');
}

export default defineConfig(async env => {
  const base = await baseConfig(env);
  return {
    ...base,
    resolve: {
      ...base.resolve,
      alias: {
        ...base.resolve.alias,
        'luma-temporal-upscale': resolve(
          lumaSource,
          'modules/engine/src/effects/temporal-upscale/index.ts'
        )
      }
    },
    server: {
      ...base.server,
      open: false,
      fs: {allow: [...(base.server.fs?.allow ?? []), resolve(lumaSource)]}
    }
  };
});
