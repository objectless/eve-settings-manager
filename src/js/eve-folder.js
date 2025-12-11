'use strict';

const $ = require('jquery')
const { shell, ipcRenderer } = require('electron')
const { join } = require('path')
const { statSync, existsSync } = require('fs')
const { readdir, readFile, writeFile } = require('node:fs/promises')
const { appendSelectOption, setSelectLoading, setSelectOptions } = require('./select-options')
const { getLocale } = require('./change-language')
const AppConfig = require('../configuration')
const phin = require('phin')

const paths = {
  win32: join('AppData', 'Local', 'CCP', 'EVE'),
  darwin: join('Library', 'Application Support', 'CCP', 'EVE')
}

const prefixes = {
  user: 'core_user_',
  char: 'core_char_'
}

const urls = {
  charName: {
    tranquility: 'https://esi.evetech.net/latest/characters/',
    serenity: 'https://ali-esi.evepc.163.com/latest/characters/',
    singularity: '',
    dawn: 'https://ali-esi.evepc.163.com/latest/characters/',
    thunderdome: ''
  },
  surfix: {
    tranquility: '/?datasource=tranquility',
    serenity: '/?datasource=serenity',
    singularity: '',
    dawn: '/?datasource=infinity',
    thunderdome: ''
  }
}

const defaultSettingFolderName = 'settings_Default'

// caches for UI + Auto Link
let _lastChars = {}
let _lastUsers = {}
let _lastLinks = {}
let _lastGroups = {}

function getServer() {
  return $('#server-select').val() ?? 'tranquility'
}

function getSelectedProfile() {
  return $('#profile-select').val() ?? defaultSettingFolderName
}

function getSelectedGroupId() {
  return $('#group-select').val() ?? 'all'
}

function clearCharacterAndUserList() {
  setSelectOptions($('#user-select'), [])
  setSelectOptions($('#char-select'), [])
}

// ----------------- LINKS (char -> user) -----------------
function linksKey() {
  return `links.${getServer()}.${getSelectedProfile()}`
}

function loadLinks() {
  const obj = AppConfig.readSettings(linksKey())
  return (obj && typeof obj === 'object') ? obj : {}
}

function saveLinks(linksObj) {
  AppConfig.saveSettings(linksKey(), linksObj)
}

function getLinks() {
  return { ...(_lastLinks ?? {}) }
}

function getLinkedUserForChar(charFile) {
  if (!charFile) return null
  return _lastLinks?.[charFile] ?? null
}

function getLinkedCharsForUser(userFile) {
  if (!userFile) return []
  const out = []
  for (const [cf, uf] of Object.entries(_lastLinks ?? {})) {
    if (uf === userFile) out.push(cf)
  }
  out.sort((a, b) => (_lastChars?.[b]?.mtimeMs ?? 0) - (_lastChars?.[a]?.mtimeMs ?? 0))
  return out
}

async function linkSelectedCharToSelectedUser() {
  const charFile = $('#char-select').val()
  const userFile = $('#user-select').val()
  if (!charFile || !userFile) return false

  const links = loadLinks()
  links[charFile] = userFile
  saveLinks(links)

  // IMPORTANT: after linking, clear account selection to avoid accidental relink
  if ($('#user-select').find('option[value=""]').length) $('#user-select').val('')
  else $('#user-select').prop('selectedIndex', -1)

  await readSettingFiles()
  return true
}

async function unlinkSelectedChar() {
  const charFile = $('#char-select').val()
  if (!charFile) return false

  const links = loadLinks()
  if (!links[charFile]) return false

  delete links[charFile]
  saveLinks(links)

  await readSettingFiles()
  return true
}

// ----------------- GROUPS -----------------
function groupsKey() {
  return `groups.${getServer()}.${getSelectedProfile()}`
}

function loadGroups() {
  const obj = AppConfig.readSettings(groupsKey())
  return (obj && typeof obj === 'object') ? obj : {}
}

function saveGroups(groupsObj) {
  AppConfig.saveSettings(groupsKey(), groupsObj)
}

function getGroups() {
  return { ...(_lastGroups ?? {}) }
}

function createGroup(name) {
  const groups = loadGroups()
  const id = `g_${Date.now()}`
  groups[id] = {
    name: (name || 'New Group').trim() || 'New Group',
    members: [],
    templateChar: ''
  }
  saveGroups(groups)
  return id
}

function deleteGroup(groupId) {
  if (!groupId || groupId === 'all') return false
  const groups = loadGroups()
  if (!groups[groupId]) return false
  delete groups[groupId]
  saveGroups(groups)
  return true
}

function addCharToGroup(groupId, charFile) {
  if (!groupId || groupId === 'all') return false
  if (!charFile) return false
  const groups = loadGroups()
  const g = groups[groupId]
  if (!g) return false
  g.members = Array.from(new Set([...(g.members ?? []), charFile]))
  saveGroups(groups)
  return true
}

function removeCharFromGroup(groupId, charFile) {
  if (!groupId || groupId === 'all') return false
  if (!charFile) return false
  const groups = loadGroups()
  const g = groups[groupId]
  if (!g) return false
  g.members = (g.members ?? []).filter(x => x !== charFile)
  if ((g.templateChar ?? '') === charFile) g.templateChar = ''
  saveGroups(groups)
  return true
}

function setGroupTemplateChar(groupId, charFile) {
  if (!groupId || groupId === 'all') return false
  if (!charFile) return false
  const groups = loadGroups()
  const g = groups[groupId]
  if (!g) return false
  if (!(g.members ?? []).includes(charFile)) {
    g.members = Array.from(new Set([...(g.members ?? []), charFile]))
  }
  g.templateChar = charFile
  saveGroups(groups)
  return true
}

async function applyGroupFromTemplate(groupId) {
  if (!groupId || groupId === 'all') return { ok: false, reason: 'no-group' }

  const selectedFolder = $('#folder-select').val()
  const profile = getSelectedProfile()
  const folderPath = selectedFolder ? join(selectedFolder, profile) : null
  if (!folderPath || !existsSync(folderPath)) return { ok: false, reason: 'no-folder' }

  const groups = loadGroups()
  const g = groups[groupId]
  if (!g) return { ok: false, reason: 'missing-group' }

  const links = loadLinks()

  const templateChar = (g.templateChar || '').trim()
  if (!templateChar) return { ok: false, reason: 'no-template' }

  const templateUser = links[templateChar]
  if (!templateUser) return { ok: false, reason: 'template-not-linked' }

  const templateCharPath = join(folderPath, `${templateChar}.dat`)
  const templateUserPath = join(folderPath, `${templateUser}.dat`)
  if (!existsSync(templateCharPath) || !existsSync(templateUserPath)) return { ok: false, reason: 'template-missing-files' }

  const templateCharContent = await readFile(templateCharPath)
  const templateUserContent = await readFile(templateUserPath)

  const members = Array.from(new Set(g.members ?? [])).filter(Boolean)
  let applied = 0
  let skipped = 0

  for (const memberChar of members) {
    if (memberChar === templateChar) continue

    const memberUser = links[memberChar]
    if (!memberUser) { skipped++; continue }

    const memberCharPath = join(folderPath, `${memberChar}.dat`)
    const memberUserPath = join(folderPath, `${memberUser}.dat`)

    if (!existsSync(memberCharPath) || !existsSync(memberUserPath)) { skipped++; continue }

    await writeFile(memberCharPath, templateCharContent)
    await writeFile(memberUserPath, templateUserContent)
    applied++
  }

  await readSettingFiles()
  return { ok: true, applied, skipped }
}

// ----------------- AUTO LINK -----------------
function autoAssociateFromRecentWrite(windowMs = 10_000) {
  const now = Date.now()
  const chosenCharFile = $('#char-select').val()
  if (!chosenCharFile || !_lastChars?.[chosenCharFile]) {
    return { ok: false, reason: 'no-character-selected' }
  }

  const freshUsers = Object.entries(_lastUsers ?? {})
    .map(([uf, u]) => ({ uf, age: now - (u.mtimeMs ?? 0), id: u.id }))
    .filter(x => x.age >= 0 && x.age < windowMs)
    .sort((a, b) => a.age - b.age)

  if (freshUsers.length === 0) return { ok: false, reason: 'none-fresh', chosenCharFile }
  if (freshUsers.length > 1) return { ok: false, reason: 'multiple-fresh', chosenCharFile, freshUsers }

  const userFile = freshUsers[0].uf
  const links = loadLinks()
  links[chosenCharFile] = userFile
  saveLinks(links)

  return { ok: true, chosenCharFile, userFile, userId: freshUsers[0].id }
}

// ----------------- APPLY LINKS (global) -----------------
async function applyLinksFromSelectedSource() {
  const selectedFolder = $('#folder-select').val()
  const profile = getSelectedProfile()
  const folderPath = selectedFolder ? join(selectedFolder, profile) : null
  if (!folderPath || !existsSync(folderPath)) return { ok: false, reason: 'no-folder' }

  const sourceChar = $('#char-select').val()
  if (!sourceChar) return { ok: false, reason: 'no-source-char' }

  const links = loadLinks()
  const sourceUser = links[sourceChar]
  if (!sourceUser) return { ok: false, reason: 'no-source-link' }

  const sourceCharPath = join(folderPath, `${sourceChar}.dat`)
  const sourceUserPath = join(folderPath, `${sourceUser}.dat`)
  if (!existsSync(sourceCharPath) || !existsSync(sourceUserPath)) return { ok: false, reason: 'source-missing-files' }

  const sourceCharContent = await readFile(sourceCharPath)
  const sourceUserContent = await readFile(sourceUserPath)

  let applied = 0
  let skipped = 0

  for (const [targetChar, targetUser] of Object.entries(links)) {
    if (!targetChar || !targetUser) { skipped++; continue }
    if (targetChar === sourceChar) continue

    const targetCharPath = join(folderPath, `${targetChar}.dat`)
    const targetUserPath = join(folderPath, `${targetUser}.dat`)
    if (!existsSync(targetCharPath) || !existsSync(targetUserPath)) { skipped++; continue }

    await writeFile(targetCharPath, sourceCharContent)
    await writeFile(targetUserPath, sourceUserContent)
    applied++
  }

  await readSettingFiles()
  return { ok: true, applied, skipped }
}

// ----------------- EXPORT / IMPORT LINKS -----------------
async function exportLinksToJsonFile() {
  const folder = await ipcRenderer.invoke('dialog:SelectFolder')
  if (!folder) return { ok: false, reason: 'cancel' }

  const links = loadLinks()
  const server = getServer()
  const profile = getSelectedProfile()

  const pad = n => String(n).padStart(2, '0')
  const d = new Date()
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

  const filename = `eve-links_${server}_${profile}_${stamp}.json`
  const outPath = join(folder, filename)

  const payload = {
    schema: 1,
    server,
    profile,
    exportedAt: d.toISOString(),
    links
  }

  await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8')
  return { ok: true, path: outPath, count: Object.keys(links).length }
}

async function importLinksFromJsonFilePath(filePath) {
  if (!filePath) return { ok: false, reason: 'no-file' }

  let obj
  try {
    const raw = await readFile(filePath, 'utf8')
    obj = JSON.parse(raw)
  } catch (_) {
    return { ok: false, reason: 'bad-json' }
  }

  const incoming = obj?.links
  if (!incoming || typeof incoming !== 'object') return { ok: false, reason: 'no-links' }

  const cleaned = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue
    if (!k.startsWith('core_char_')) continue
    if (!v.startsWith('core_user_')) continue
    cleaned[k] = v
  }

  const current = loadLinks()
  const merged = { ...current, ...cleaned }
  saveLinks(merged)

  await readSettingFiles()
  return { ok: true, imported: Object.keys(cleaned).length, total: Object.keys(merged).length }
}

// ----------------- FIND PROFILES + FOLDERS -----------------
async function findProfiles() {
  clearCharacterAndUserList()
  const profileSelect = $('#profile-select')
  setSelectLoading(profileSelect)

  const selectedFolder = $('#folder-select').val()
  if (!selectedFolder) {
    setSelectOptions(profileSelect, [])
    return
  }

  const profileDirectories = (await readdir(selectedFolder, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .filter(entry => entry.name.startsWith('settings_'))
    .map(entry => entry.name)

  if (profileDirectories.length === 0) {
    setSelectOptions(profileSelect, [])
    return
  }

  const server = getServer()
  const savedProfile = AppConfig.readSettings(`savedProfile.${server}`)

  let preferred = null
  if (savedProfile && profileDirectories.includes(savedProfile)) preferred = savedProfile
  else if (profileDirectories.includes(defaultSettingFolderName)) preferred = defaultSettingFolderName
  else preferred = profileDirectories[0]

  const profileDirectoryToOption = profileDirectory => ({
    value: profileDirectory,
    text: profileDirectory.replace(/^settings_/, '').replaceAll(/_/g, ' ')
  })

  setSelectOptions(profileSelect, profileDirectories.map(profileDirectoryToOption))
  if (preferred) {
    profileSelect.val(preferred)
    AppConfig.saveSettings(`savedProfile.${server}`, preferred)
  }
}

async function readDefaultFolders() {
  const folderSelect = $('#folder-select')
  setSelectOptions(folderSelect, [])

  const server = getServer()
  const os = process.platform
  const homePath = process.env[(os === 'win32') ? 'USERPROFILE' : 'HOME']
  const fullPath = join(homePath, paths[os])

  const defaultDirs =
    (await readdir(fullPath, { withFileTypes: true }))
      .filter(dirent => dirent.isDirectory())
      .filter(dirent => dirent.name.includes(server))
      .map(dirent => join(fullPath, dirent.name))

  if (defaultDirs.length === 0) return

  setSelectOptions(folderSelect, defaultDirs.map(dir => ({ value: dir, text: dir })))

  let savedFolder = AppConfig.readSettings(`savedFolder.${server}`)
  if (!savedFolder) savedFolder = defaultDirs[0]
  else if (!defaultDirs.includes(savedFolder)) appendSelectOption(folderSelect, savedFolder, savedFolder)

  folderSelect.find(`option[value="${savedFolder}"]`).prop('selected', true)

  await findProfiles()
  await readSettingFiles()
}

async function setSelectedFolder(folderPath) {
  if (!folderPath) return
  const server = getServer()
  AppConfig.saveSettings(`savedFolder.${server}`, folderPath)

  const folderSelect = $('#folder-select')
  appendSelectOption(folderSelect, folderPath, folderPath, true)

  await new Promise(r => setTimeout(r, 100))
  await findProfiles()
  await readSettingFiles()
}

function openFolder() {
  const folderPath = join($('#folder-select').val(), getSelectedProfile())
  shell.openPath(folderPath)
}

// ----------------- HELPERS -----------------
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let i = 0
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return results
}

function buildCharGroupsMap(groups) {
  const map = {}
  for (const [gid, g] of Object.entries(groups || {})) {
    const name = (g?.name ?? gid).trim() || gid
    const members = (g?.members ?? []).filter(Boolean)
    const templateChar = (g?.templateChar ?? '').trim()
    for (const cf of members) {
      if (!map[cf]) map[cf] = []
      map[cf].push({ gid, name, isTemplate: cf === templateChar })
    }
  }
  return map
}

// ----------------- READ + RENDER -----------------
async function readSettingFiles() {
  const selects = $('.select-list')
  setSelectLoading(selects)

  const selectedFolder = $('#folder-select').val()
  if (!selectedFolder) {
    setSelectOptions(selects, [])
    return
  }

  const folderPath = join(selectedFolder, getSelectedProfile())
  if (!existsSync(folderPath)) {
    setSelectOptions(selects, [])
    return
  }

  const prevChar = $('#char-select').val() || ''
  const prevUser = $('#user-select').val() || ''

  const server = getServer()

  const files =
    (await readdir(folderPath, { withFileTypes: true }))
      .filter(dirent => dirent.isFile())
      .filter(dirent => (
        dirent.name.startsWith('core_') &&
        dirent.name.endsWith('.dat') &&
        !(dirent.name.split('.')[0].endsWith('_') || dirent.name.split('.')[0].endsWith(')'))
      ))
      .map(dirent => dirent.name.split('.')[0])

  if (files.length === 0) {
    setSelectOptions(selects, [])
    return
  }

  const charFiles = files.filter(f => f.startsWith(prefixes.char))
  const userFiles = files.filter(f => f.startsWith(prefixes.user))

  const chars = {}
  const users = {}

  const missingNameLookups = []
  for (const file of charFiles) {
    const id = file.split('_')[2]
    const st = statSync(join(folderPath, `${file}.dat`))

    chars[file] = {
      id,
      mtimeMs: st.mtimeMs ?? st.mtime.getTime(),
      mtime: st.mtime.toLocaleString('zh-CN'),
      name: '<unknown>'
    }

    const savedDescription = AppConfig.readSettings(`descriptions.${server}.${file}`)
    if (savedDescription) chars[file].description = savedDescription

    if (['tranquility', 'serenity'].includes(server)) {
      const savedName = AppConfig.readSettings(`names.${server}.${file}`)
      if (savedName) chars[file].name = savedName
      else missingNameLookups.push({ file, id })
    }
  }

  if (missingNameLookups.length && ['tranquility', 'serenity'].includes(server)) {
    await mapLimit(missingNameLookups, 4, async ({ file, id }) => {
      try {
        const res = await phin(urls.charName[server] + id + urls.surfix[server])
        if (res.statusCode === 200) {
          const name = JSON.parse(res.body).name
          chars[file].name = name
          AppConfig.saveSettings(`names.${server}.${file}`, name)
        }
      } catch (_) {}
    })
  }

  for (const file of userFiles) {
    const id = file.split('_')[2]
    const st = statSync(join(folderPath, `${file}.dat`))

    users[file] = {
      id,
      mtimeMs: st.mtimeMs ?? st.mtime.getTime(),
      mtime: st.mtime.toLocaleString('zh-CN')
    }

    const savedDescription = AppConfig.readSettings(`descriptions.${server}.${file}`)
    if (savedDescription) users[file].description = savedDescription
  }

  _lastLinks = loadLinks()
  _lastGroups = loadGroups()
  _lastChars = chars
  _lastUsers = users

  const groupId = getSelectedGroupId()
  const group = (groupId !== 'all') ? _lastGroups?.[groupId] : null
  const allowedChars = group ? new Set((group.members ?? []).filter(Boolean)) : null

  // build groups-per-char map for visibility
  const charGroups = buildCharGroupsMap(_lastGroups)

  // reverse user -> chars
  const reverse = {}
  for (const [cf, uf] of Object.entries(_lastLinks ?? {})) {
    if (!reverse[uf]) reverse[uf] = []
    reverse[uf].push(cf)
  }
  for (const uf of Object.keys(reverse)) {
    reverse[uf].sort((a, b) => (chars[b]?.mtimeMs ?? 0) - (chars[a]?.mtimeMs ?? 0))
  }

  // allowed users based on allowed chars
  let allowedUsers = null
  if (allowedChars) {
    allowedUsers = new Set()
    for (const cf of allowedChars) {
      const uf = _lastLinks[cf]
      if (uf) allowedUsers.add(uf)
    }
  }

  // USERS select
  const userSelect = $('#user-select')
  const userEntries = Object.entries(users)
    .filter(([uf]) => !allowedUsers || allowedUsers.has(uf))

  const userOptions = [
    { value: '', text: '— pick an account —' },
    ...userEntries.map(([filename, values]) => {
      const linkedCharFiles = (reverse[filename] ?? [])
        .filter(cf => chars[cf] && (!allowedChars || allowedChars.has(cf)))

      const linkedNames = linkedCharFiles.map(cf => chars[cf].name || cf)
      const linkedText =
        linkedNames.length
          ? ` - chars:${linkedNames.length} (${linkedNames.join(', ')})`
          : ''

      return {
        value: filename,
        text: `${values.id} - ${values.mtime}${linkedText}` + (values.description ? ` - [${values.description}]` : '')
      }
    })
  ]
  setSelectOptions(userSelect, userOptions)

  if (prevUser && userSelect.find(`option[value="${prevUser}"]`).length) userSelect.val(prevUser)
  else userSelect.val('')

  // CHARS select
  const charSelect = $('#char-select')
  const charEntries = Object.entries(chars)
    .filter(([cf]) => !allowedChars || allowedChars.has(cf))

  const templateChar = (group?.templateChar ?? '').trim()

  const charOptions = [
    { value: '', text: '— pick a character —' },
    ...charEntries.map(([filename, values]) => {
      const linkedUser = getLinkedUserForChar(filename)
      let acctText = ''
      if (linkedUser && users[linkedUser]) acctText = ` - acct:${users[linkedUser].id}`
      else if (linkedUser) acctText = ` - acct:${linkedUser}`

      // group visibility markers
      let prefix = ''
      if (groupId !== 'all') {
        if (filename === templateChar) prefix = '★ '
        else if (allowedChars && allowedChars.has(filename)) prefix = '● '
      } else {
        const gs = (charGroups[filename] ?? []).map(x => x.name)
        if (gs.length) prefix = '● '
      }

      // when "All", show group tags inline
      let groupTag = ''
      if (groupId === 'all') {
        const gs = (charGroups[filename] ?? []).map(x => x.name)
        if (gs.length) groupTag = ` - [${gs.join(', ')}]`
      }

      return {
        value: filename,
        text: `${prefix}${values.id} - ${values.name} - ${values.mtime}${acctText}${groupTag}` +
              (values.description ? ` - [${values.description}]` : '')
      }
    })
  ]
  setSelectOptions(charSelect, charOptions)

  if (prevChar && charSelect.find(`option[value="${prevChar}"]`).length) charSelect.val(prevChar)
  else charSelect.val('')

  // Native tooltips for full linked char list on accounts
  // (Bootstrap tooltips don't attach to <option>, but title usually works)
  try {
    $('#user-select option').each((_, opt) => {
      const val = opt.value
      if (!val) return
      opt.title = opt.text
    })
  } catch (_) {}
}

// ----------------- OVERWRITE -----------------
async function overwrite(args) {
  const content = await readFile(join(args.folder, args.selected))
  const targets = args.targets
  if (!targets || targets.length === 0) return

  for (const target of targets) {
    await writeFile(join(args.folder, target), content)
  }

  ipcRenderer.send('dialog:Notification', getLocale().titles.successMsg)
  await readSettingFiles()
}

module.exports = {
  findProfiles,
  getSelectedProfile,
  readDefaultFolders,
  setSelectedFolder,
  openFolder,
  readSettingFiles,
  overwrite,

  // links
  linkSelectedCharToSelectedUser,
  unlinkSelectedChar,
  getLinkedUserForChar,
  getLinkedCharsForUser,
  getLinks,

  // groups
  getGroups,
  createGroup,
  deleteGroup,
  addCharToGroup,
  removeCharFromGroup,
  setGroupTemplateChar,
  applyGroupFromTemplate,

  // auto-link
  autoAssociateFromRecentWrite,

  // apply links global
  applyLinksFromSelectedSource,

  // import/export links
  exportLinksToJsonFile,
  importLinksFromJsonFilePath
}