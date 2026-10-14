# Contributing to TodoTodoList

Thank you for helping improve the personal workspace. Focused bug fixes, clearer setup instructions, accessibility improvements, and reproducible sync tests are useful contributions.

## Local development

Read [AGENTS.md](AGENTS.md), then follow the [local quick start](README.md#try-it-locally). Use Node.js 22 and `npm ci` to match CI. Keep all reproduction data synthetic; the seed command provides sample Markdown files without external credentials.

Before opening a pull request, run:

```bash
npm test
npm run build
npm run check
```

CI also runs `npm audit --omit=dev --registry=https://registry.npmjs.org`. If an existing advisory blocks your branch, report the affected package and distinguish it from changes introduced by your PR; do not disable the check.

## Propose a change

1. Search existing issues and pull requests for the same problem.
2. For a substantial behavior change, open a feature request describing the current workflow, the problem, and the desired outcome before implementing it.
3. Keep each pull request focused on one change. Include before/after behavior and the checks you actually ran.
4. Add regression tests for behavior changes, especially sync conflicts, timezone boundaries, and state persistence. Documentation-only changes need link and command checks rather than new unit tests.
5. Update both README language entry points when their shared product description or quick start changes.

## Useful starting points

- Clarify a setup step that failed during your own local installation.
- Reproduce calendar boundaries using synthetic events and explicit timezones.
- Improve keyboard access, form labels, or empty states with a before/after example.
- Add a regression test for a verified Markdown import or snapshot merge bug.

These are contribution areas, not preassigned issues. Check the current tracker before starting.

## Protect personal data

Do not include real schedules, screenshots of private tasks, tokens, deployment addresses, databases, logs, or runtime backups in a PR or issue. Use placeholder domains such as `example.com` and redact credentials from error messages. Review the diff before submitting.
