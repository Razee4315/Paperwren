# 11 · Privacy & Compliance

> Paperwren's privacy posture is not a policy page — it's an architectural fact. The app has nothing to connect *with*: no analytics SDK, no ads SDK, no crash uploader, and v1 makes no network calls at all. This document turns that into user-facing words and Play Store form answers.

---

## 1. The "Zero" promise (marketing-ready)

> **Zero permissions. Zero accounts. Zero tracking. Zero network.**
> Your files are opened on your device, in your device, and stay on your device.

Every claim here must stay literally true. Any future feature that would break one of the four zeros requires revisiting this document *first* — that's the point.

## 2. Permissions posture

| Permission | Status | Why |
|------------|--------|-----|
| Storage / media permissions | **Not requested** | SAF picker + "open with" intents make them unnecessary |
| Internet | **Not requested** | Nothing to fetch; updates come from the Play Store, not us |
| Camera, location, contacts, microphone | **Not requested** | Obviously |
| POST_NOTIFICATIONS | Not requested | No notifications exist |

**Verifiable claim:** the merged manifest ships with zero `uses-permission` entries (a debug build's "App info" screen shows "no permissions" — worth a screenshot in the store listing and in the Privacy settings page).

## 3. What Paperwren stores on the device (complete list)

| Item | Purpose | Location | User control |
|------|---------|----------|--------------|
| Recent-files list (name, location-uri, format, size, dates, last position) | Show recents, resume reading | App-private storage | Settings → Files & storage: turn off, limit count, clear all, or remove individually |
| Preferences (theme, viewer defaults, …) | Remember your choices | App-private storage | Cleared on app uninstall / "clear data" |
| Cached copy of opened files | Let parsers re-read; speed | App-private **cache** dir | Auto-purged (LRU 250 MB / 30 days); one-tap "Clear cache" |
| PDF passwords | Unlock in-session only | **Memory only** | Never written anywhere; gone when file closes |

Nothing else. No cookies, no identifiers, no advertising ID reads, no fingerprinting surfaces.

## 4. What leaves the device

**Nothing.** Specifically and exhaustively:

- ❌ No analytics or usage stats
- ❌ No crash reports uploaded (crash logs, if any, stay local; users can copy a diagnostic report *themselves* from About → "Copy diagnostic info" to send to support if they choose)
- ❌ No file contents, names, or metadata transmitted
- ❌ No fonts, updates, config, or "phone-home" fetches
- ✅ The only outbound actions are user-initiated OS intents: opening the Play Store page (rate/update) and composing a support email

## 5. Children, ads, and sensitive categories

| Topic | Status |
|-------|--------|
| Ads / ad SDKs | None, ever (also satisfies "no ads" Families policy questions trivially) |
| Children's data | No data collected from anyone, including children; app is not directed at children but contains nothing age-sensitive |
| Financial info, health, biometrics | Not accessed, not stored |
| Encryption | All user data stays in app-private storage (OS sandbox); no transmission exists to encrypt |
| Account deletion flows | N/A — no accounts exist |

## 6. Privacy policy (ready to publish)

> Short enough to actually be read; store it as an in-app page *and* a Play Console URL.

---

**Paperwren Privacy Policy**

*Last updated: September 3, 2026*

Paperwren is a document viewer. This policy is short because Paperwren collects almost nothing.

**What Paperwren collects: nothing.** Paperwren does not collect, transmit, sell, or share any personal data. It has no analytics, no advertising, no trackers, and it does not connect to the internet.

**What stays on your device:**

- **Recent files list** — names and locations of documents you open, so the app can show them and resume where you stopped. You can turn this off or clear it anytime in Settings → Files & storage.
- **Your settings** — choices like theme and zoom preferences.
- **Cache** — temporary copies of files you open, stored where only Paperwren can read them, deleted automatically or by you anytime.
- **Passwords you type** to open protected PDFs are used in memory for that session and never saved.

**Files you open** are read and displayed on your device only. Paperwren never uploads them anywhere because it never talks to any server.

**Permissions:** Paperwren requests none. It sees only files you open directly or share to it from other apps.

**Changes:** if a future version ever changes any of the above, this policy will be updated and the app will tell you before the change takes effect.

**Contact:** [support email]

---

## 7. Play Store "Data safety" form answers

| Question | Answer |
|----------|--------|
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | N/A (nothing collected) |
| Do you provide a way for users to request that their data is deleted? | N/A (nothing collected) |

That's the entire form. "No" across the board is the payoff of the zero-dependency architecture (doc 10).

## 8. Other compliance checklist

| Item | Requirement | Paperwren status |
|------|-------------|--------------|
| Target API level | Current Play requirement (35+ at build time) | Set in Tauri config; verify per release |
| 16 KB page sizes | Required for native libs on newer devices | Verify Rust/NDK build flags at integration |
| Content rating questionnaire | Answer honestly; no user interaction/UGC/ads → **Everyone** | Trivial pass |
| Ads declaration | "No ads" | True by architecture |
| Open-source licenses | Attribution screen required by MIT/Apache/OFL/MPL terms | Auto-generated Licenses page (doc 08 SET-05) |
| Accessibility declaration | TalkBack support etc. | doc 12 §5 |
| Privacy policy URL | Required by Play | Host the doc §6 text (GitHub Pages is fine) |

## 9. The trust surface (why users should believe the words)

Back every claim with something checkable:

1. **No-permission screenshot** in Play listing ("Paperwren asks for nothing — not even internet").
2. **In-app Privacy page** (SET-04) restates §6 in the same plain words.
3. **Reproducible builds** (CI-built, versioned) so technical users can diff binaries — a long-term credibility project, noted now, started when convenient.
4. **Licenses page** listing every bundled library — transparency as a feature.

---

*Next: [12 · Production Readiness & Launch](12-production.md) — QA, test corpus, store listing, release process.*
