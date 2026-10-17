# Player data isolation — how one player's save stays theirs

Road Kill is **local-first**: progress lives in the browser, not on a server.
That is the whole reason this document exists. When everything is on one
device, "whose data is this?" is a real question, and the answer used to be
"whoever touched it last" — every account on a shared phone read and wrote the
single record `main` / `rk.profile.v2`.

That is now fixed. This file describes what was changed, what it does and does
not protect against, and exactly what a sign-up page has to do on top of it.

---

## 1. The namespace (`src/identity.js`)

Every per-player key is built from `accountId()`:

| | before | now |
|---|---|---|
| IndexedDB profile | `profile/main` | `profile/<accountId>:profile` |
| localStorage mirror | `rk.profile.v2` | `rk.<accountId>.profile.v2` |
| sync queue fallback | `rk.syncqueue.v1` | `rk.<accountId>.syncqueue.v1` |
| match history | shared `matches` store | record carries `accountId`, reads filter on it |

With no sign-in yet, `accountId()` creates a stable per-browser **guest** id
(`g` + 24 hex chars) the first time it is asked, and keeps it forever. For a
single player nothing behaves differently. For two people on one browser, each
gets their own slot: coins, gems, unlocks, XP, stats and match history no longer
bridge between them.

Switching is a single call:

```js
import { setAccountId, signOut, onAccountChange } from './identity.js';

setAccountId(user.id);   // after a successful sign-in
signOut();               // back to a fresh guest slot
onAccountChange(() => { /* reload profile + rebuild the car */ });
```

### One id, not two

The game already had an account id before this module existed — `backend.js`
generates `rk.account.v1` and the server sends one on connect; it keys the
wallet mirror, `exportSyncCode` and the Supabase stub. Creating a second,
independent id here would have split one player's data across two namespaces, so
instead:

- **Adopted** — when the namespace is first created, an existing `rk.account.v1`
  is used rather than minting a fresh one, so storage and sync start out equal.
- **Mirrored** — `setAccountId()` and `signOut()` also write `rk.account.v1`, so
  a sign-up lands on a single identity shared by storage *and* sync.
- **Never followed automatically** — when the server updates `rk.account.v1`
  mid-session this module deliberately does *not* follow it. The profile still
  in memory belongs to the old namespace, and saving it under a new name is
  exactly the bridge this exists to prevent. A namespace switch happens only at
  an explicit boundary (`setAccountId` / `signOut`, then reload).

`backend.js` imports `economy.js`, which imports this module — so this module
never imports `backend.js` back. The legacy key is read as a raw literal for
that reason; a cycle here would be a module-init trap.

### What this is *not*

- **It is not authentication.** `accountId()` is a label, not proof of
  anything. It is generated in the browser and anyone can set it to any value.
- **It is not encryption.** Local storage is exactly as private as the device.
  Anyone with the phone can read the profile. That is inherent to a local-first
  game, and it is why any currency that has to be *trustworthy* must live
  server-side after sign-in rather than being mirrored here.
- **It does not survive clearing site data**, and it does not sync between
  devices. Neither does progress today.

---

## 2. What is namespaced, and what deliberately is not

**Per-account** (this is player data — it must not bridge):

- currency (coins, gems), XP, level, tier
- unlocked vehicles, weapons, skins; equipped loadout
- career stats and per-vehicle stats
- match history and everything derived from it (`getMatchStats`: wins, best
  position, kills, XP)
- the queued sync operations carrying that progress

**Per-device, on purpose** (`rk.settings.v1`): audio, quality, touch controls,
steering side, orientation. These describe the *handset*, not the player, they
carry no progress, and `src/main.js` reads this key directly in three places.
There is nothing in them to bridge. If a future feature puts progress in
settings — for example a per-account "last car" — that field has to move into
the profile first.

---

## 3. Migration: existing saves are kept

Someone who already has progress must not lose it, and the old un-namespaced
data must not be copied twice.

- `migrateLegacyStorage()` in `src/storage.js` copies `rk.profile.v2` and the
  `profile/main` IndexedDB record into the **guest** namespace, once.
- The claim marker (`rk.legacy-claimed.v1`) is deliberately **device-scoped**,
  not per-account. The legacy keys hold exactly one player's data and may be
  claimed by exactly one namespace — whoever loads first. If the marker were
  namespaced, the next account to sign in would find it absent and re-copy the
  old player's coins and unlocks into the new account. That is the failure mode
  this whole document is about, so it gets its own guard.
- Match records written before this change carry no `accountId`. They stay
  visible, because in the single-slot era they could only have belonged to
  whoever is playing now. New records are always stamped.

---

## 4. What the sign-up page still has to do

The groundwork above makes isolation *possible*. The following is what a real
account system must add — none of it exists yet, and none of it should be
assumed from this code:

1. **The server issues the uid.** `setAccountId()` must be called with an id
   from the auth backend, never with anything the client invented. Treat the
   client's `accountId` as an opaque namespace hint at most.
2. **The server owns authoritative progress.** Currency, unlocks and stats that
   matter must be validated server-side on every change. The local profile is a
   cache and an offline mode, not a ledger. Today's sync queue
   (`enqueueSyncOp`) is a stub shaped like `POST /api/sync` for exactly this.
3. **One-time guest upload, then abandon.** Signing in should upload the guest
   slot's progress once and then discard it. Merging two namespaces silently is
   how duplicated coins happen; an explicit, user-visible transfer is the safe
   shape.
4. **Never log or ship credentials.** No passwords, tokens, keys or env files
   in this repo — the client bundle is public. Server secrets belong in the
   server's environment, which this project never touches.
5. **Sign-out clears the active namespace.** `signOut()` already mints a new
   guest slot so the next person cannot read the previous account's local data.

---

## 5. How to check it is still working

**`sim/data-isolation-check.mjs`** exercises the real `src/identity.js` +
`src/storage.js` in a browser (the game itself does not boot) and asserts the
properties above. Run it against the dev server:

```
node sim/data-isolation-check.mjs        # needs :5199 up
```

It covers:

| assertion | what it prevents |
|---|---|
| legacy save migrates into the namespace **once** — re-running with a poisoned legacy record does not resurface it | new accounts inheriting the old player's coins |
| B sees defaults after A writes 4242, under a different LS key and IDB id | the original single-record bridge |
| B's coins and `stats.wins` do not appear when A resumes | cross-account leakage through the profile |
| a save still inside its 250 ms debounce window is **not** redirected by `setAccountId()` | the one real bridge found while writing this doc — see §6 |
| B reads **0** matches after A records a race; stats say `races: 0` | shared match history / career stats |
| `setAccountId` mirrors `rk.account.v1`, so storage and sync share one id | two identities drifting apart |
| `signOut()` mints a fresh guest slot and clears the backend id | the next player reading the previous one's data |
| the sync queue reads back without throwing | the key rename leaving a dead reference |

The static half is a grep over literal keys:

```
grep -rn "localStorage\.\(get\|set\)Item('rk\.[^<]" src/
```

Every hit must be one of these deliberately **device-scoped** keys — and nothing
else:

| key | why it is not per-player |
|---|---|
| `rk.settings.v1` | handset settings, carries no progress |
| `rk.identity.v1` | *creates* the namespace; it cannot be inside one |
| `rk.account.v1` | the same id, mirrored for backend sync (see §1) |
| `rk.server.url` | which server to talk to |
| `rk.banners.queue` | dismissed tutorial banners |

A new literal `rk.<something>` appearing here without a per-account suffix is a
per-player key that has escaped namespacing. The other half is that the old keys
are never *written* outside migration:

```
grep -rn "rk\.profile\.v2\|'main'" src/ | grep -v "LEGACY\|//"
```

which must only match `storage.js` legacy constants, `migrateLegacyStorage()`,
and comments explaining the history.

---

## 6. The two bugs this document was written the hard way

Recorded because they are the failure modes a future sign-up page will walk
straight back into.

**Two accounts on one device** — everything used to be addressed by `'main'` and
`'rk.profile.v2'`, so a second player simply read and wrote the first player's
record. Fixed by namespacing every per-player key on `accountId()`.

**A delayed save crossing an account switch** — `saveProfileUnified()` debounces
its IndexedDB write by 250 ms, and the write resolved `profileKey()` **when the
timer fired**, not when the save was scheduled. A sign-up page saves and then
calls `setAccountId(uid)` on the same tick, so the outgoing guest's profile
would be filed under the incoming account's id and *overwrite* it — one player's
coins landing in another's slot. The namespace is now captured once, up front,
and both the immediate and deferred writes use that capture
(`saveProfileIDB(profile, key)` / `saveProfileLS(profile, key)`). This is exactly
what the "pending save cannot land in the next account" assertion pins down.
