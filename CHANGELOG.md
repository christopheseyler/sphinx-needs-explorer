# Changelog

All versions below are releases of the **Sphinx-Needs Explorer** community fork. For the history of the original
extension, see [useblocks/sphinx-needs-vscode](https://github.com/useblocks/sphinx-needs-vscode).

## 0.4.0

- Published as **Sphinx-Needs Explorer** (`christopheseyler.sphinx-needs-explorer`), community fork of the
  deprecated `useblocks.sphinx-needs-vscode` extension.
- New extension icons; help view links point to this fork.

## 0.3.7

- Filter button in the **Sphinx-Needs Current** view: current document or all needs, need types, tags.

## 0.3.6

- Need items are split into **Fields**, **Links Outgoing** and **Links Incoming** sections; clicking a link jumps
  to the linked need. The `explorerOptions` default is now `status`, `type`, `tags`.

## 0.3.5

- Refresh button in the Explorer and Current views.
- Views update when the language mode of the active document changes; included files show the needs defined in
  them.

## 0.3.4

- Goto Definition, Find References and Locate follow `.. include::` directives to find the file defining a need.
- Exact need ID matching (`REQ_1` no longer matches `REQ_10`).

## 0.3.3

- Hover shows the need content with recent Sphinx-Needs versions (`content` instead of `description`).
- Locate and Copy ID actions in the **Sphinx-Needs Current** view.

## 0.3.2

- Fix `needs.json` / `srcDir` path handling and file URIs on Windows.
