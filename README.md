# EVE Settings Manager (v2)

A third-party tool for managing **local settings files** for EVE Online.

Forked and extended from [mintnick/eve-settings-manager](https://github.com/mintnick/eve-settings-manager) (MIT).

### Highlights

- 🌙 **Dark-themed UI**
  - Full dark mode pass so it doesn’t burn your eyes when you alt-tab out of EVE.
  - Cleaned-up layout, clearer buttons, tooltips for the “scary” actions.

- 🔗 **Character ↔ Account linking**
  - Manually link a character file to an account file.
  - “Auto link” helper that watches for the most recent settings write and guesses the correct account.
  - Quick badges that show the currently selected character + account.

- 👥 **Groups**
  - Create named groups (e.g. “Mains”, “PI alts”, “Abyss crew”).
  - Drop characters into groups, or add all chars linked to an account in one click.
  - Pick a **template character** for each group, then:
    - **Apply Group** copies that template’s settings + linked account to group members only.

- 🌐 **Apply Links (global)**
  - Uses your saved char↔account links to copy one source pair’s settings to every other linked pair in the profile.

- 🧠 **Smarter profile handling**
  - Tries to pick the most likely profile on startup (recently used / has data).
  - Keeps your current profile and selections stable when editing groups and links.

- 🆘 **Built-in Help**
  - New **Help** window with step-by-step instructions, tips, and credit information.
  - Accessible from the toolbar and from the footer link.

---

This tool only manipulates **local profile/settings files**. Nothing more, nothing less.

License: MIT (see `LICENSE`)


## Install / run from source

```bash
npm install
npm run dev
