'use strict';

const { ipcRenderer } = require('electron');
const $ = require('jquery');
const AppConfig = require('../configuration');
const { changeLanguage, getLocale } = require('./change-language');
const { changeServer } = require('./eve-server');
const {
  openFolder,
  getSelectedProfile,
  setSelectedFolder,
  readSettingFiles,
  overwrite,
  findProfiles,

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

  // auto
  autoAssociateFromRecentWrite,

  // apply global
  applyLinksFromSelectedSource,

  // import/export links
  exportLinksToJsonFile,
  importLinksFromJsonFilePath
} = require('./eve-folder');

const { editDescription } = require('./edit-description');
const { backupFiles } = require('./backup');
const { join } = require('path');
const { readdir } = require('node:fs/promises');
const { setSelectOptions } = require('./select-options');

const localePath = join(__dirname, '../locales');

// core selects
const languageSelect = $('#language-select');
const serverSelect   = $('#server-select');
const folderSelect   = $('#folder-select');
const profileSelect  = $('#profile-select');

// top buttons
const selectFolderBtn = $('#select-folder-btn');
const openFolderBtn   = $('#open-folder-btn');
const backupBtn       = $('#backup-btn');
const clearCacheBtn   = $('#clear-cache-btn');

const exportLinksBtn  = $('#export-links-btn');
const importLinksBtn  = $('#import-links-btn');
const importLinksInput = $('#import-links-input');

// help (toolbar + footer)
const helpBtn  = $('#help-btn');
const helpLink = $('#help-link');

// edit / overwrite buttons
const editDescriptionBtn = $('.edit-description-btn');
const overwriteBtn       = $('.overwrite-btn');

// link buttons
const linkAccountBtn   = $('#link-account-btn');
const unlinkAccountBtn = $('#unlink-account-btn');
const autoLinkBtn      = $('#auto-link-btn');
const applyLinksBtn    = $('#apply-links-btn');

// status + selects
const linkStatus = $('#link-status');
const charSelect = $('#char-select');
const userSelect = $('#user-select');
const charBadge  = $('#char-badge');
const acctBadge  = $('#acct-badge');

// group controls
const groupSelect          = $('#group-select');
const newGroupBtn          = $('#new-group-btn');
const deleteGroupBtn       = $('#delete-group-btn');
const addToGroupBtn        = $('#add-to-group-btn');
const removeFromGroupBtn   = $('#remove-from-group-btn');
const setTemplateBtn       = $('#set-template-btn');
const applyGroupBtn        = $('#apply-group-btn');
const addLinkedToGroupBtn  = $('#add-linked-to-group-btn');

function init () {
  initSelects()
    .then(() => {
      bindEvents();
      initTooltips();
    })
    .catch(err => {
      console.error('initSelects failed:', err);
    });
}

/* -----------------------------
 * INITIAL SELECT POPULATION
 * ----------------------------- */
async function initSelects () {
  // --- languages ---
  const locales = (await readdir(localePath, { withFileTypes: true }))
    .filter(d => d.isFile() && d.name.endsWith('.json'))
    .map(d => join(localePath, d.name));

  setSelectOptions(
    languageSelect,
    locales.map(locale => ({
      value: locale.replace(/^.*[\\\/]/, '').split('.')[0],
      text: require(locale).language
    }))
  );

  let language = AppConfig.readSettings('language');
  if (!language) {
    const localeLang = Intl.DateTimeFormat().resolvedOptions().locale;
    language = localeLang.includes('zh') ? 'zh-CN' : 'en';
  }
  languageSelect.val(language);
  changeLanguage(language);

  // --- servers (labels translated from current locale) ---
  rebuildServerOptions();

  let server = AppConfig.readSettings('server');
  const serverOptions = $('#server-select option').toArray().map(o => o.value);
  if (!serverOptions.includes(server)) {
    server = 'tranquility';
    AppConfig.saveSettings('server', server);
  }
  serverSelect.val(server);

  // update title text
  const currentLabel =
    $('#server-select option:selected').text() || server;
  $('#server-title').text(currentLabel);

  // now load filesystem bits
  await changeServer(server);
  await readSettingFiles();
  refreshGroupSelect();
  updateLinkUI();
}

/**
 * Rebuild the server <select> options using the current locale.
 * Called once on init and again whenever the language changes.
 */
function rebuildServerOptions () {
  const locale = getLocale() || {};

  const options = [
    {
      value: 'tranquility',
      text: locale.servers?.tranquility || 'Tranquility'
    },
    {
      value: 'serenity',
      text: locale.servers?.serenity || 'Serenity (CN)'
    },
    {
      value: 'singularity',
      text: locale.servers?.singularity || 'Singularity (Test)'
    },
    {
      value: 'infinity',
      text: locale.servers?.infinity || 'Infinity (CN)'
    },
    {
      value: 'thunderdome',
      text: locale.servers?.thunderdome || 'Thunderdome (Event)'
    }
  ];

  setSelectOptions(serverSelect, options);
}

function initTooltips () {
  if (!window.bootstrap) return;
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    new window.bootstrap.Tooltip(el, { trigger: 'hover focus' });
  });
}

/* -----------------------------
 * SMALL HELPERS
 * ----------------------------- */
function escapeHtml (s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setBadge ($el, text) {
  if (!$el.length) return;
  if (!text) {
    $el.html('');
    return;
  }
  $el.html(`<span class="pill">${escapeHtml(text)}</span>`);
}

function updateBadges () {
  const charFile = charSelect.val() || null;
  const userFile = userSelect.val() || null;

  if (!charFile) {
    setBadge(charBadge, '');
  } else {
    const text = charSelect.find(`option[value="${charFile}"]`).text();
    const parts = text.split(' - ');
    const charId = parts[0] ?? '';
    const charName = parts[1] ?? '';
    setBadge(charBadge, `Selected Character: ${charName} (${charId})`);
  }

  if (!userFile) {
    setBadge(acctBadge, '');
  } else {
    const text = userSelect.find(`option[value="${userFile}"]`).text();
    const acctId = (text.split(' - ')[0] ?? '').trim();
    setBadge(acctBadge, `Selected Account: ${acctId}`);
  }
}

function serverKey () {
  return serverSelect.val() ?? 'tranquility';
}

function groupSaveKey () {
  return `savedGroup.${serverKey()}.${getSelectedProfile()}`;
}

/**
 * After any mutation to groups, re-read files and refresh UI.
 */
async function refreshAfterGroupMutation(preserveChar = true, preserveUser = true) {
  // Remember where we were
  const prevProfile = profileSelect.val() || '';
  const prevChar    = preserveChar ? (charSelect.val() || '') : '';
  const prevUser    = preserveUser ? (userSelect.val() || '') : '';
  const prevGroup   = groupSelect.val() || 'all';

  // Re-read the files (this can repopulate selects)
  await readSettingFiles();

  // Put the profile selector back where it was
  if (prevProfile && profileSelect.find(`option[value="${prevProfile}"]`).length) {
    profileSelect.val(prevProfile);
  }

  // Rebuild groups now that the data is fresh
  refreshGroupSelect();

  // Restore group if it still exists
  if (groupSelect.find(`option[value="${prevGroup}"]`).length) {
    groupSelect.val(prevGroup);
  } else {
    groupSelect.val('all');
  }

  // Restore character & account selection if they still exist
  if (prevChar && charSelect.find(`option[value="${prevChar}"]`).length) {
    charSelect.val(prevChar);
  }
  if (prevUser && userSelect.find(`option[value="${prevUser}"]`).length) {
    userSelect.val(prevUser);
  }

  // Re-sync account with linked char and refresh all the button states/badges
  syncUserToLinkedChar();
  updateLinkUI();
}


/* -----------------------------
 * GROUP + LINK UI
 * ----------------------------- */
function refreshGroupSelect () {
  if (!groupSelect.length) return;

  const groups = getGroups() || {};
  const options = [{ value: 'all', text: 'All (no group filter)' }];

  for (const [id, g] of Object.entries(groups)) {
    const name     = (g?.name ?? id).trim();
    const members  = (g?.members ?? []).filter(Boolean).length;
    const template = (g?.templateChar ?? '').trim();

    let templateName = '';
    if (template) {
      const optText = charSelect.find(`option[value="${template}"]`).text();
      if (optText) templateName = (optText.split(' - ')[1] ?? '').trim();
    }

    const label = template
      ? `${name} (${members}) ★ ${templateName || template}`
      : `${name} (${members})`;

    options.push({ value: id, text: label });
  }

  setSelectOptions(groupSelect, options);

  const saved = AppConfig.readSettings(groupSaveKey());
  if (saved && groupSelect.find(`option[value="${saved}"]`).length) {
    groupSelect.val(saved);
  } else if (!groupSelect.val()) {
    groupSelect.val('all');
  }
}

function syncUserToLinkedChar () {
  const charFile   = charSelect.val() || null;
  const linkedUser = getLinkedUserForChar(charFile);

  if (linkedUser && userSelect.find(`option[value="${linkedUser}"]`).length) {
    userSelect.val(linkedUser);
    return;
  }

  if (userSelect.find('option[value=""]').length) {
    userSelect.val('');
  } else {
    userSelect.prop('selectedIndex', -1);
  }
}

function updateGroupUI () {
  const gid    = groupSelect.val() ?? 'all';
  const groups = getGroups() || {};
  const g      = gid !== 'all' ? groups[gid] : null;
  const charFile = charSelect.val() || null;
  const userFile = userSelect.val() || null;
  const linkedCharsForAcct = userFile ? getLinkedCharsForUser(userFile) : [];

  addLinkedToGroupBtn.prop(
    'disabled',
    !(gid !== 'all' && userFile && linkedCharsForAcct.length > 0)
  );
  deleteGroupBtn.prop('disabled', gid === 'all');
  addToGroupBtn.prop('disabled', !(gid !== 'all' && charFile));
  removeFromGroupBtn.prop(
    'disabled',
    !(gid !== 'all' && charFile && (g?.members ?? []).includes(charFile))
  );
  setTemplateBtn.prop('disabled', !(gid !== 'all' && charFile));

  const template = (g?.templateChar ?? '').trim();
  applyGroupBtn.prop('disabled', !(gid !== 'all' && template));
}

function updateLinkUI () {
  const charFile = charSelect.val() || null;
  const userFile = userSelect.val() || null;

  const linkedUser  = getLinkedUserForChar(charFile);
  const linkedChars = getLinkedCharsForUser(userFile);

  linkAccountBtn.prop('disabled', !(charFile && userFile));
  unlinkAccountBtn.prop('disabled', !(charFile && linkedUser));

  const hasAnyChar = $('#char-select option').length > 1;
  const hasAnyUser = $('#user-select option').length > 1;
  autoLinkBtn.prop('disabled', !(hasAnyChar && hasAnyUser));

  const linksCount = Object.keys(getLinks() ?? {}).length;
  const hasSource  = !!(charFile && linkedUser);
  applyLinksBtn.prop('disabled', !(linksCount > 0 && hasSource));

  updateGroupUI();
  updateBadges();

  if (linkStatus.length) {
    // leave whatever status text you had previously; not changed here
  }
}

/* -----------------------------
 * EVENT BINDINGS
 * ----------------------------- */
function bindEvents () {
  // HELP WINDOW (toolbar button + footer link)
  const openHelp = async (e) => {
    if (e) e.preventDefault();
    try {
      await ipcRenderer.invoke('window:OpenHelp');
    } catch (err) {
      ipcRenderer.send(
        'dialog:Notification',
        `Help window failed to open: ${err?.message || err}`
      );
    }
  };

  if (helpBtn && helpBtn.length) {
    helpBtn.on('click', openHelp);
  }
  if (helpLink && helpLink.length) {
    helpLink.on('click', openHelp);
  }

  // selection changes
  charSelect.on('change', () => {
    syncUserToLinkedChar();
    updateLinkUI();
  });
  userSelect.on('change', updateLinkUI);

  // group selection change
  groupSelect.on('change', async () => {
    AppConfig.saveSettings(groupSaveKey(), groupSelect.val() ?? 'all');
    await readSettingFiles();
    refreshGroupSelect();
    syncUserToLinkedChar();
    updateLinkUI();
  });

    // NEW GROUP (uses electron-prompt via main process)
  newGroupBtn.on('click', async (e) => {
    e.preventDefault()

    try {
      const name = await ipcRenderer.invoke('dialog:NewGroupName')
      if (!name || !String(name).trim()) return

      const clean = String(name).trim()
      const id = createGroup(clean)

      AppConfig.saveSettings(groupSaveKey(), id)
      groupSelect.val(id)

      await refreshAfterGroupMutation(true, true)
    } catch (err) {
      ipcRenderer.send(
        'dialog:Notification',
        `Failed to create group: ${err?.message || err}`
      )
    }
  })


  deleteGroupBtn.on('click', async (e) => {
    e.preventDefault();
    const gid = groupSelect.val() ?? 'all';
    if (gid === 'all') return;
    const ok = window.confirm(
      'Delete this group? (No settings files will be deleted.)'
    );
    if (!ok) return;
    deleteGroup(gid);
    AppConfig.saveSettings(groupSaveKey(), 'all');
    groupSelect.val('all');
    await refreshAfterGroupMutation(true, true);
  });

addToGroupBtn.on('click', async (e) => {
  e.preventDefault();
  const gid = groupSelect.val() ?? 'all';
  const cf = charSelect.val() || '';
  if (!cf || gid === 'all') return;
  addCharToGroup(gid, cf);
  await refreshAfterGroupMutation(true, true);  // now also restores profile
});


  addLinkedToGroupBtn.on('click', async (e) => {
    e.preventDefault();
    const gid = groupSelect.val() ?? 'all';
    const uf  = userSelect.val() || null;
    if (gid === 'all' || !uf) return;
    const chars = getLinkedCharsForUser(uf);
    if (!chars.length) return;
    for (const cf of chars) addCharToGroup(gid, cf);
    await refreshAfterGroupMutation(true, true);
  });

  removeFromGroupBtn.on('click', async (e) => {
    e.preventDefault();
    const gid = groupSelect.val() ?? 'all';
    const cf  = charSelect.val() || '';
    if (!cf || gid === 'all') return;
    removeCharFromGroup(gid, cf);
    await refreshAfterGroupMutation(true, true);
  });

  setTemplateBtn.on('click', async (e) => {
    e.preventDefault();
    const gid = groupSelect.val() ?? 'all';
    const cf  = charSelect.val() || '';
    if (!cf || gid === 'all') return;
    setGroupTemplateChar(gid, cf);
    await refreshAfterGroupMutation(true, true);
  });

  applyGroupBtn.on('click', async (e) => {
    e.preventDefault();
    const gid = groupSelect.val() ?? 'all';
    if (gid === 'all') return;

    const ok = window.confirm(
      'Apply Group will copy the group template Character + linked Account settings to ONLY the characters in this group.\n\nMake sure to make Backup first.\n\nContinue?'
    );
    if (!ok) return;

    const res = await applyGroupFromTemplate(gid);
    if (res.ok) {
      ipcRenderer.send(
        'dialog:Notification',
        `Apply Group: applied to ${res.applied} member(s), skipped ${res.skipped}.`
      );
      await refreshAfterGroupMutation(true, true);
    } else {
      ipcRenderer.send('dialog:Notification', 'Apply Group failed.');
      updateLinkUI();
    }
  });

  // link ops
  linkAccountBtn.on('click', async (e) => {
    e.preventDefault();
    await linkSelectedCharToSelectedUser();
    syncUserToLinkedChar();
    updateLinkUI();
  });

  unlinkAccountBtn.on('click', async (e) => {
    e.preventDefault();
    await unlinkSelectedChar();
    updateLinkUI();
  });

  autoLinkBtn.on('click', async (e) => {
    e.preventDefault();

    const selectedChar = charSelect.val() || '';
    if (!selectedChar) {
      ipcRenderer.send(
        'dialog:Notification',
        'Auto Link: pick a character first.'
      );
      return;
    }

    await readSettingFiles();

    if (charSelect.find(`option[value="${selectedChar}"]`).length) {
      charSelect.val(selectedChar);
    } else {
      ipcRenderer.send(
        'dialog:Notification',
        'Auto Link: selected character disappeared after refresh.'
      );
      updateLinkUI();
      return;
    }

    const res = autoAssociateFromRecentWrite(10_000);

    if (res.ok) {
      await readSettingFiles();
      if (res.chosenCharFile) charSelect.val(res.chosenCharFile);
      if (res.userFile) userSelect.val(res.userFile);
      ipcRenderer.send(
        'dialog:Notification',
        `Auto Link saved (acct ${res.userId}).`
      );
      syncUserToLinkedChar();
    } else {
      ipcRenderer.send('dialog:Notification', 'Auto Link failed.');
    }

    updateLinkUI();
  });

  applyLinksBtn.on('click', async (e) => {
    e.preventDefault();
    const charFile   = charSelect.val() || null;
    const linkedUser = getLinkedUserForChar(charFile);
    const linksCount = Object.keys(getLinks() ?? {}).length;
    if (!charFile || !linkedUser || linksCount === 0) {
      ipcRenderer.send(
        'dialog:Notification',
        'Apply Links: pick a linked character first.'
      );
      return;
    }
    const ok = window.confirm(
      `Apply Links will copy the selected Character + its linked Account settings to every other linked pair in this profile.\n\nLinks found: ${linksCount}\n\nMake sure to make Backup first.\n\nContinue?`
    );
    if (!ok) return;
    const res = await applyLinksFromSelectedSource();
    if (res.ok) {
      ipcRenderer.send(
        'dialog:Notification',
        `Apply Links: applied to ${res.applied} pair(s), skipped ${res.skipped}.`
      );
      await readSettingFiles();
      syncUserToLinkedChar();
    } else {
      ipcRenderer.send('dialog:Notification', 'Apply Links failed.');
    }
    updateLinkUI();
  });

  // top selects + folder flow
  languageSelect.on('change', async () => {
    const lang = languageSelect.val();
    changeLanguage(lang);

    // rebuild server labels for new language
    const currentServer = serverSelect.val() || 'tranquility';
    rebuildServerOptions();
    if ($('#server-select option[value="' + currentServer + '"]').length) {
      serverSelect.val(currentServer);
    } else {
      serverSelect.val('tranquility');
    }

    const titleText =
      $('#server-select option:selected').text() || serverSelect.val();
    $('#server-title').text(titleText);
  });

  serverSelect.on('change', async () => {
    const server = serverSelect.val();
    AppConfig.saveSettings('server', server);

    const titleText =
      $('#server-select option:selected').text() || server;
    $('#server-title').text(titleText);

    await changeServer(server);
    await readSettingFiles();
    refreshGroupSelect();
    syncUserToLinkedChar();
    updateLinkUI();
  });

  folderSelect.on('change', async () => {
    AppConfig.saveSettings(
      `savedFolder.${serverSelect.val()}`,
      folderSelect.val()
    );
    await findProfiles();
    await readSettingFiles();
    refreshGroupSelect();
    syncUserToLinkedChar();
    updateLinkUI();
  });

  profileSelect.on('change', async () => {
    await readSettingFiles();
    refreshGroupSelect();
    syncUserToLinkedChar();
    updateLinkUI();
  });

  selectFolderBtn.on('click', async (e) => {
    e.preventDefault();
    const folderPath = await ipcRenderer.invoke('dialog:SelectFolder');
    await setSelectedFolder(folderPath);
    await readSettingFiles();
    refreshGroupSelect();
    syncUserToLinkedChar();
    updateLinkUI();
  });

  openFolderBtn.on('click', (e) => {
    e.preventDefault();
    openFolder();
  });

  backupBtn.on('click', (e) => {
    e.preventDefault();
    backupFiles();
  });

  clearCacheBtn.on('click', (e) => {
    e.preventDefault();
    AppConfig.clear();
    ipcRenderer.send('reload');
  });

  // edit description
  editDescriptionBtn.on('click', async (e) => {
    e.preventDefault();
    const args = {};

    const id   = e.currentTarget.id;
    const type = id.includes('char') ? 'char' : 'user';
    args.type  = type;

    const file = $(`#${type}-select`).val();
    if (!file) return;
    args.file = file;

    const server = $('#server-select').val();
    args.server  = server;

    const savedDescription = AppConfig.readSettings(
      `descriptions.${server}.${file}`
    );
    if (savedDescription) args.savedDescription = savedDescription;

    const description = await ipcRenderer.invoke('dialog:EditDescription', args);
    if (description === null || description === savedDescription) return;

    args.savedDescription = description;
    editDescription(args);

    await readSettingFiles();
    syncUserToLinkedChar();
    updateLinkUI();
  });

  // overwrite buttons
  overwriteBtn.on('click', async (e) => {
    e.preventDefault();
    const args = {};

    const btnId = e.currentTarget.id;
    args.type   = btnId.includes('char') ? 'char' : 'user';

    const select = $(`#${args.type}-select`).val();
    if (!select) return;

    const folder  = $('#folder-select').val();
    const profile = getSelectedProfile();
    args.folder   = join(folder, profile);
    args.selected = select + '.dat';

    let targets = $(`#${args.type}-select option`).not(':selected').toArray();

    if (btnId.includes('selected')) {
      args.targets = targets.map(t => t.innerText);
      ipcRenderer.send('dialog:SelectTargets', args);
      updateLinkUI();
      return;
    }

    const label = args.type === 'char' ? 'ALL Characters' : 'ALL Accounts';
    const ok = window.confirm(
      `Overwrite ${label} with the selected settings?\n\nTip: Make sure to make Backup first.`
    );
    if (!ok) return;

    args.targets = targets.map(t => t.value + '.dat');
    await overwrite(args);
    syncUserToLinkedChar();
    updateLinkUI();
  });
}

module.exports = { init };
