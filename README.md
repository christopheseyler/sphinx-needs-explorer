# Sphinx-Needs Explorer for Visual Studio Code

> [!NOTE]
> **Community fork of a deprecated extension.**
> This extension is a fork of [useblocks/sphinx-needs-vscode](https://github.com/useblocks/sphinx-needs-vscode),
> the original Sphinx-Needs extension for VS Code, which useblocks has deprecated and no longer maintains
> (useblocks now develops [ubCode](https://marketplace.visualstudio.com/items?itemName=useblocks.ubcode)).
>
> The project is taken over to fix bugs found while using it (notably on Windows and with recent
> Sphinx-Needs versions) and to add a few features for navigating requirements.
> It is **not affiliated with or endorsed by useblocks**. Many thanks to the original authors for their work.

[Sphinx-Needs](https://sphinx-needs.readthedocs.io/en/latest/) is a [Sphinx](https://www.sphinx-doc.org)
extension to manage requirements, specifications, test cases and other "needs" in your documentation.

**Sphinx-Needs Explorer** brings an enhanced experience for editing and navigating Sphinx-Needs projects in
[VS Code](https://code.visualstudio.com/): code completion, hover, goto definition, find references and tree views
of your needs and their links.

## What's new in this fork

**Bug fixes**

- **Windows**: `needs.json` and `srcDir` are now found on Windows, and Goto Definition / Find References work there.
- **Recent Sphinx-Needs versions**: hover shows the need content (stored as `content` instead of `description`
  in recent `needs.json` files).
- **Included files**: needs defined in files pulled in with `.. include::` are located in the right file.
- Need IDs are matched exactly (`REQ_1` no longer matches `REQ_10`).

**New features**

- **Sphinx-Needs Current view**:
  - **Locate** and **Copy ID** actions on each need.
  - **Refresh** button.
  - **Filter** button: show the needs of the current document or all needs of the `needs.json`, filter by need type
    and by tags.
  - Included files (e.g. `*.inc` set to reStructuredText) show the needs defined in them.
- Each need is split into **Fields**, **Links Outgoing** and **Links Incoming** sections, including extra links
  (`satisfies`, `verifies`, ...); clicking a link jumps to the linked need.

See the [CHANGELOG](CHANGELOG.md) for details.

## Quick Start

1. Install **Sphinx-Needs Explorer** from the VS Code Marketplace, or download the `.vsix` file of a
   [release](https://github.com/christopheseyler/sphinx-needs-explorer/releases) and run:

   ```
   code --install-extension sphinx-needs-explorer-<version>.vsix
   ```

   If the original **Sphinx-Needs** extension (`useblocks.sphinx-needs-vscode`) is installed, uninstall it first:
   both extensions use the same commands and settings.

2. Build your Sphinx-Needs documentation, so that a `needs.json` file is generated
   (see [needs_build_json](https://sphinx-needs.readthedocs.io/en/latest/configuration.html#needs-build-json)).

3. Configure the paths in `.vscode/settings.json`:

   ```json
   {
       "sphinx-needs.needsJson": "${workspaceFolder}/docs/_build/html/needs.json",
       "sphinx-needs.srcDir": "${workspaceFolder}/docs"
   }
   ```

   ![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/settings.gif)

4. Open any **.rst** file to activate the extension.

## Settings

| Setting | Description |
| --- | --- |
| `sphinx-needs.needsJson` | Path to the `needs.json` file. |
| `sphinx-needs.srcDir` | Sphinx source directory of the documentation. |
| `sphinx-needs.folders` | List of `needsJson` / `srcDir` pairs, for several Sphinx-Needs projects in one workspace. |
| `sphinx-needs.activateFiles` | Languages for which the language features are enabled. |
| `sphinx-needs.explorerOptions` | Need options shown in the **Fields** section (default: `status`, `type`, `tags`). |
| `sphinx-needs.explorerItemHoverOptions` | Need options shown when hovering a need in the views. |
| `sphinx-needs.loggingLevel` | Logging level of the extension. |

`${workspaceFolder}` can be used in paths.

## Features

**Code Completion:**

![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/features_code_completion_snippets.gif)

**Hover:**

![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/features_hover.gif)

**Goto Definition:**

![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/features_goto.gif)

**Find References:**

![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/features_find_references.gif)

**ID Selection:**

![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/features_id_selection.gif)

**ID Auto Generation:**

![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/features_id_auto_gen.gif)

## User Interface

The animations below show the views of the original extension; the fork adds the Fields / Links sections,
the filter and the refresh buttons described above.

**Sphinx-Needs Views:**

![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/sn-views.gif)

**Sphinx-Needs Current View:**

![image](https://raw.githubusercontent.com/christopheseyler/sphinx-needs-explorer/main/docs/_images/sn-current-view.gif)

## License

[MIT](LICENSE). Original work Copyright (c) 2022 useblocks, fork changes Copyright (c) 2026 Christophe Seyler.
