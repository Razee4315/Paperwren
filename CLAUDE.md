# Paperwren: rules for AI assistants

- Never add `Co-Authored-By`, `Claude-Session`, "Generated with Claude Code",
  or any other AI attribution to commits, PR titles, or PR bodies.
  (`.claude/settings.json` sets `attribution` to empty to enforce this.)
- Run `npm run lint`, `npm run build`, `npm test`, and
  `cargo test --manifest-path src-tauri/Cargo.toml` before pushing.
- The app is a viewer: no network, no permissions, no editing.
