import test from 'node:test'
import assert from 'node:assert/strict'
import { legacySlugify } from '../scripts/legacy-markdown.mjs'

test('VuePress bookmarks retain numeric prefixes, Chinese punctuation and accents', () => {
  assert.equal(legacySlugify('1、快速上手须知'), '_1、快速上手须知')
  assert.equal(legacySlugify('指令通道(CmdChannel)'), '指令通道-cmdchannel')
  assert.equal(legacySlugify('pageComponent.data.path'), 'pagecomponent-data-path')
  assert.equal(legacySlugify('Déjà vu & HTTPS'), 'deja-vu-https')
})
