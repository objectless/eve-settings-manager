'use strict'

const path = require('path')
const AppConfig = require('../configuration')

let _locale = null
let _code = 'en'

function safeRequireLocale(code) {
  const p = path.join(__dirname, '../locales', `${code}.json`)
  try {
    delete require.cache[require.resolve(p)]
  } catch (_) {}
  try {
    return require(p)
  } catch (_) {
    return null
  }
}

function normalizeCode(code) {
  const c = String(code || '').trim()
  if (!c) return 'en'
  const lc = c.toLowerCase()

  // accept common zh aliases but load your existing file
  if (lc === 'zh' || lc.startsWith('zh-')) return 'zh-CHT'

  return c
}

function applyTextMap(textMap) {
  if (!textMap || typeof textMap !== 'object') return
  for (const [id, text] of Object.entries(textMap)) {
    if (typeof text !== 'string') continue
    const el = document.getElementById(id)
    if (el) el.textContent = text
    if (id === 'app-title') document.title = text
  }
}

function changeLanguage(code) {
  const want = normalizeCode(code)

  // load with fallbacks (NEVER throw)
  const loaded =
    safeRequireLocale(want) ||
    (want === 'zh-CHT' ? safeRequireLocale('en') : null) ||
    safeRequireLocale('en') ||
    { language: 'English', titles: {}, buttons: {}, text: {} }

  _locale = loaded
  _code = want

  try { AppConfig.saveSettings('language', want) } catch (_) {}

  try {
    if (typeof document !== 'undefined') {
      applyTextMap(loaded.text)
    }
  } catch (_) {}

  return _locale
}

function getLocale() {
  if (_locale) return _locale

  let saved = 'en'
  try { saved = AppConfig.readSettings('language') || 'en' } catch (_) {}
  changeLanguage(saved)

  return _locale || { language: 'English', titles: {}, buttons: {}, text: {} }
}

module.exports = { changeLanguage, getLocale }
