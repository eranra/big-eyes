# Contributing to Big Eyes

Thank you for wanting to help. Big Eyes is a small, friendly project, and every kind of contribution is welcome:
bug reports, ideas, new eye themes, translations of the texts, documentation, and code.

## Ways to contribute

- **Report a bug.** Open an [issue](../../issues/new?template=bug_report.md). Tell us your system, your camera,
  and what you saw. For tracking problems, turn on **Show Debug Info** and copy the numbers.
- **Suggest an idea.** Open a [feature request](../../issues/new?template=feature_request.md).
- **Add a theme.** Themes are plain data in [`src/core/settings.ts`](src/core/settings.ts) (`THEMES`).
  Add one, run `npm run snapshots`, and include the new image in your pull request.
- **Fix or improve code.** Look for issues labeled `good first issue` or `help wanted`.
- **Improve the docs.** Typos, clearer steps and screenshots help a lot.

## Development setup

You need [Node.js](https://nodejs.org/) 20 or newer and git. On macOS, the Xcode Command Line Tools
(`xcode-select --install`) build the small native idle helper; without them the app still works with a simpler idle
counter.

```sh
git clone https://github.com/eranra/big-eyes.git
cd big-eyes
npm install
npm run fetch-model   # downloads the face model (3.7 MB, checked by SHA-256)
npm run dev           # starts the app and shows the eyes at once, with tracking numbers
```

If your npm configuration blocks install scripts, run `node node_modules/electron/install.js` once.

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | Build and start, show the eyes at once, show tracking numbers |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript type check |
| `npm run check` | Type check and tests. Run this before every pull request |
| `npm run snapshots` | Render `docs/images/*.png` from the real drawing code |
| `npm run dist` | Build an installer for your system into `./dist` |
| `./install.sh --from-source` | macOS: build and install into /Applications |

How the code is organized: [docs/architecture.md](docs/architecture.md).

## Pull requests

1. Fork the repository and create a branch from `main` (for example `fix/camera-list` or `theme/owl`).
2. Make your change. Keep each pull request about one topic.
3. Add or update tests. Logic that decides *what the eyes do* lives in `src/core/` and must have unit tests.
4. Run `npm run check`. CI runs the same checks on macOS, Windows and Linux.
5. If you changed how the eyes look, run `npm run snapshots` and include the updated images.
6. Open the pull request and fill in the template: what changed and how you tested it.

A maintainer reviews every pull request. We may ask for changes; this is normal and not a judgment of your work.

### Commit messages

Write short, clear messages in the present tense, for example `Add owl theme` or `Fix camera list after unplugging`.
[Conventional Commits](https://www.conventionalcommits.org/) prefixes (`feat:`, `fix:`, `docs:`) are welcome but not required.

## Project rules

- **Privacy first.** No network requests at run time, no stored images, no analytics. See [docs/privacy.md](docs/privacy.md).
- **Keep it light.** Avoid new run-time dependencies unless they are clearly needed.
- **Plain English.** Write comments and docs in simple English, so non-native speakers can read them easily.
- **Code style.** TypeScript in strict mode, 2-space indent, as set in `.editorconfig`.

## License of contributions

Big Eyes is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution, you agree that it is
licensed under the same license (see section 5 of the license). You keep the copyright of your contribution.

## Code of Conduct

Everyone taking part in this project must follow the [Code of Conduct](CODE_OF_CONDUCT.md). Be kind.
