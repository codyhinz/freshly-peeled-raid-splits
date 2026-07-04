# Freshly Peeled — Raid Splits

A lightweight web app for planning and communicating World of Warcraft (TBC Classic) raid splits for the **Freshly Peeled** guild. Built with plain HTML/CSS/JS (no frameworks, no build step) and a Google Sheets + Apps Script backend.

Live app: https://codyhinz.github.io/freshly-peeled-raid-splits/

## What it does

- **Roster management** — maintain a single source of truth for every character on the roster: class, spec, role, offspec role, main/alt status, DST eligibility, and absence.
- **Splits builder** — drag and drop characters into two 25-man splits (Split A / Split B), each made up of 5 groups of 5. Dragging onto an occupied slot swaps the two characters.
- **Live validation** — a checklist flags missing raid essentials (enough tanks/healers, Paladins for Blessings, a Balance Druid for the physical hit debuff, a Shaman in every group, etc.) as you build, before you save.
- **Both Splits view** — a single screenshot-friendly popup showing both splits at once, each with its own tank/healer counts, for quick posting to Discord.
- **Mark absent from the Splits page** — hover any character chip (in the pool or in a group) to reveal a quick toggle, so a last-minute "can't make it" doesn't require a trip to the Roster page.
- **Pilot mode** — a banner/flag for nights when a character's usual player isn't the one playing it.
- **Buff coverage per group** — each group shows which raid buffs it currently covers, based on the classes/specs seated in it.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Login — stores the Apps Script backend URL and the shared access password for the session. |
| `roster.html` | Add, edit, and remove characters on the roster. |
| `splits.html` | Drag-and-drop split builder, validation panel, Both Splits view, and absence toggling. |

## Tech stack

- **Frontend:** Plain HTML/CSS/JS, no frameworks. Hosted on GitHub Pages.
- **Backend:** Google Apps Script (`Code.gs`), bound to a Google Sheet. Acts as a simple REST-ish API (`doGet` for reads, `doPost` for writes) with a shared-password check on writes.
- **Data storage:** Google Sheet with three tabs — `Roster` (one row per character), `Splits` (current group assignments, stored as a JSON blob), and `Config` (holds the shared access password).
- **Icons:** Class/spec/buff icons loaded at runtime from the Wowhead zamimg CDN.

## Project structure

```
├── index.html          Login page
├── roster.html          Roster management page
├── splits.html          Splits builder page
├── Code.gs               Google Apps Script backend (deploy separately)
├── css/
│   └── style.css         Shared design tokens + base styles
├── js/
│   ├── api.js            Backend fetch/post wrapper + session handling
│   ├── constants.js       Class/spec metadata, raid buffs, validation rules, RAID_CONFIG
│   ├── login.js           Login page logic
│   ├── roster.js          Roster page logic
│   ├── splits.js          Splits builder logic (drag-and-drop, validation, Both Splits modal, absence toggle)
│   └── validation.js      Shared validation helpers
└── assets/
    ├── icons/             Local icon assets
    └── img/               Guild logo / image assets
```

## Setup

### 1. Backend (Google Sheets + Apps Script)

1. Create a Google Sheet with three tabs named exactly `Roster`, `Splits`, and `Config`.
2. In the `Roster` tab, add a header row matching (in order):
   `PlayerName, CharName, Class, Spec, Role, OffspecRole, MainOrAlt, DSTEligible, Absent`
3. In the `Config` tab, store the shared access password (see `Code.gs` for the exact cell it reads from).
4. Open **Extensions → Apps Script** on the Sheet, paste in the contents of `Code.gs`.
5. Deploy it as a **Web App**: `Deploy → New deployment → Web app`, with **Execute as: Me** and **Who has access: Anyone with the link**.
6. Copy the resulting web app URL — you'll paste this into the login page.

### 2. Frontend

The frontend is fully static — no build step. Either:

- Open `index.html` directly, or
- Host the whole repo on GitHub Pages (Settings → Pages → deploy from `main`).

On first login, enter the Apps Script web app URL and the shared password. These are stored in `sessionStorage`, so they need to be re-entered each new browser session.

## Key business rules

- A character can only have **one roster entry** — the same toon regardless of who's piloting it that night. If someone else pilots a character for a session, edit that character's existing `PlayerName` rather than creating a duplicate row.
- A character can only be seated in **one split at a time**.
- **Alts cannot be DST eligible.**
- Splits are validated against a fixed checklist (minimum 18 players, 3+ Paladins, 3+ tanks, 4+ healers, at least 1 Balance Druid, one of each class present, a Shaman in every group) — hard rules block/flag the split, soft rules just warn.

## Notes

- `saveRoster()` and `saveSplits()` each overwrite their entire respective sheet — there's no per-row patching, so avoid editing the Roster and Splits pages simultaneously in two tabs.
- The absence toggle on the Splits page calls the same `saveRoster()` endpoint the Roster page uses, so it stays in sync everywhere the character appears.
