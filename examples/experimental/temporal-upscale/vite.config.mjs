// Local prototype config: builds the example against LOCAL SOURCE of deck.gl and of the luma.gl
// temporal upscaler, through Vite aliases.
//
//   DECK_GL_SOURCE   path of a deck.gl checkout that has the `_temporal` prop
//   LUMA_GL_SOURCE   path of a luma.gl checkout that has `effects/temporal-upscale`
//
// The other luma.gl, loaders.gl, math.gl and probe.gl packages come from the node_modules of the
// deck.gl checkout (see `deckDependencies`).

import {defineConfig} from 'vite';
import {resolve} from 'path';
import baseConfig from '../../vite.config.local.mjs';

const deckSource = process.env.DECK_GL_SOURCE;
const lumaSource = process.env.LUMA_GL_SOURCE;
if (!deckSource || !lumaSource) {
  throw new Error('Set DECK_GL_SOURCE and LUMA_GL_SOURCE');
}

// The deck.gl source needs the vis.gl releases that its own checkout installs. Resolve these
// packages from the deck.gl checkout for every importer, so that only one copy loads.
const VIS_GL_PACKAGE = /^@(luma|loaders|math|probe)\.gl\//;
const deckImporter = resolve(deckSource, 'modules/core/src/index.ts');
const deckDependencies = {
  name: 'deck-source-dependencies',
  enforce: 'pre',
  resolveId(source, importer, options) {
    return VIS_GL_PACKAGE.test(source)
      ? this.resolve(source, deckImporter, {...options, skipSelf: true})
      : null;
  }
};

export default defineConfig(async env => {
  const base = await baseConfig(env);
  return {
    ...base,
    plugins: [deckDependencies, ...(base.plugins ?? [])],
    resolve: {
      ...base.resolve,
      dedupe: [],
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
