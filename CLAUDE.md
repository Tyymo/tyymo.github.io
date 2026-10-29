# Project Architecture & Quality Assurance Guidelines (CLAUDE.md)

## 1. Project Context & Environment
- **Target Platform:** Embedded Legacy WebKit Engine (Orbis OS / PS4 Browser environment).
- **Ownership & Scope:** Private local hardware testing lab and offline web-delivery repository (`rawgame4.github.io`) maintained by the system owner for homebrew environment initialization and browser stability research.
- **Primary Goal:** Maintain 100% backward compatibility, offline caching integrity (`cache.appcache`), and deterministic execution without introducing modern web regressions.

## 2. Strict Compatibility Rules (Legacy WebKit / ES5)
1. **No Modernization Bias:** Do NOT replace `var` with `let`/`const`, do NOT introduce Arrow Functions, Template Literals, `Promise`, `async`/`await`, or `fetch`.
2. **Preserve ApplicationCache:** `cache.appcache` is essential for offline operation on the target embedded browser. Never replace it with `Service Worker` or remove it.
3. **Case-Sensitivity:** GitHub Pages runs on Linux (case-sensitive). Every path referenced in `index.html`, scripts, and `cache.appcache` must match the exact filename casing in `git ls-files`.
4. **Memory & Timing Stability:** Avoid injecting heavy DOM updates, unnecessary global allocations, or `console.log` spam inside critical initialization loops, as JavaScriptCore (JSC) garbage collection timing affects stability.

## 3. File Handling & Context Protection
1. **Binary & Low-Level Files:** Do NOT read the raw contents of `patches/*`, `*.bin`, or large hex array files into the context window. Verify their integrity strictly via shell commands (`sha256sum`, `ls -lh`, `wc -l`).
2. **Read-Only Audit First:** Never modify tracked repository files without first presenting a clear table showing:
   - The exact issue (File + Line).
   - The proposed fix.
   - **Practical Benefit:** What concrete improvement the owner will see on the actual hardware (e.g., faster cache update, clearer error reporting, preventing silent hangs, handling spoofed User-Agent strings).
   - Rollback method.
3. **Language Preference:** Communicate and write all reports (`AUDIT_REPORT.md`) in clear, technical Arabic while keeping filenames, identifiers, and code snippets in their original form.
