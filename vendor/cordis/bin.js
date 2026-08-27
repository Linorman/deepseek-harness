#!/usr/bin/env node

import { Context } from '@clocky/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@clocky/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@clocky/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
