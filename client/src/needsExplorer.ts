'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LogLevel, TimeStampedLogger } from './logging';

// Normalize a file system path, so that paths from settings and from document URIs can be compared
function normalizePath(givenPath: string): string {
	if (!givenPath) {
		return givenPath;
	}
	const normalized = path.normalize(givenPath);
	// VS Code uses lower case drive letters on Windows, e.g. c:\..., while users may write C:\...
	if (process.platform === 'win32' && /^[a-zA-Z]:/.test(normalized)) {
		return normalized.charAt(0).toLowerCase() + normalized.slice(1);
	}
	return normalized;
}

// Replace ${workspaceFolder} in given configuration path and normalize it
function resolveConfPath(confPath: string | undefined, workspaceFolderPath: string): string | undefined {
	if (!confPath) {
		return confPath;
	}
	return normalizePath(confPath.replace('${workspaceFolder}', workspaceFolderPath));
}

interface Needs {
	[need_id: string]: Need;
}

interface Need {
	id: string;
	description: string;
	content?: string;
	docname: string;
	doctype: string;
	status: string;
	title: string;
	type: string;
	parent_need: string;
}

interface SNVConfig {
	needsJson: string | undefined;
	srcDir: string | undefined;
	folders: DocConf[];
	explorerOptions: string[] | undefined;
	explorerItemHoverOptions: string[] | undefined;
	loggingLevel: LogLevel;
}

interface DocConf {
	needsJson: string;
	srcDir: string;
}

interface NeedsPerDoc {
	[doc_path: string]: Needs;
}

interface NeedsInfo {
	needs: Needs;
	// All needs of the needsJson, while needs may be filtered for current document
	all_needs?: Needs;
	allFiles: string[];
	src_dir: string;
	needs_json: string;
	needs_per_doc: NeedsPerDoc;
}

interface NeedsInfos {
	[path: string]: NeedsInfo;
}

let tslogger: TimeStampedLogger;

export class NeedsExplorerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<NeedTree[] | undefined> = new vscode.EventEmitter<
		NeedTree[] | undefined
	>();
	readonly onDidChangeTreeData: vscode.Event<NeedTree[] | undefined> = this._onDidChangeTreeData.event;

	needsInfo: NeedsInfo = {
		needs: {},
		allFiles: [],
		src_dir: '',
		needs_json: '',
		needs_per_doc: {}
	};
	snvConfigs: SNVConfig;
	needsInfos: NeedsInfos = {};
	isMultiDocs = false;
	currEditorView = false;

	constructor(currEditorView: boolean) {
		// Get workspace configurations and init snvConfigs
		this.snvConfigs = this.getSNVConfigurations();

		// Initial logger
		tslogger = new TimeStampedLogger(this.snvConfigs.loggingLevel);

		// Check needsJson and srcDir from workspace configurations
		this.check_wk_configs();

		// Load all needsJsons from workspace configurations
		this.needsInfos = this.loadAllNeedsJsonsToInfos();

		// Check if current treeview for active editor
		this.currEditorView = currEditorView;

		// Watch active editor change to update tree view
		vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged());

		// Changing the language mode of a document reopens it, e.g. *.inc file set to reStructuredText
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (vscode.window.activeTextEditor?.document.uri.toString() === doc.uri.toString()) {
				this.onActiveEditorChanged(doc);
			}
		});

		// Create file watcher for needs.json
		this.watcher();

		// Listen to workspace configuration change event
		this.listenToChangeConfiguration();
	}

	openNeedsJson(): void {
		// Open needsJson
		const need_json_path = this.needsInfo.needs_json;
		if (need_json_path && this.pathExists(need_json_path)) {
			vscode.window.showTextDocument(vscode.Uri.file(need_json_path));
		}
	}

	openSettings(): void {
		// Open Settings of this extension
		vscode.commands.executeCommand('workbench.action.openSettings', 'sphinx-needs');
	}

	openSphinxNeedsOfficialDocs(): void {
		// Open Sphinx-Needs official docs in default external browser
		// vscode.env.openExternal(vscode.Uri.parse('https://sphinx-needs.readthedocs.io/en/latest/index.html'));

		// Open Sphinx-Needs official docs in internal simple browser inside vscode
		vscode.commands.executeCommand(
			'simpleBrowser.api.open',
			'https://sphinx-needs.readthedocs.io/en/latest/index.html'
		);
	}

	goToDefinition(item: NeedTree): void {
		vscode.workspace.openTextDocument(item.idLoc.uri).then((doc) => {
			vscode.window.showTextDocument(doc).then((editor) => {
				editor.selections = [new vscode.Selection(item.idLoc.range.start, item.idLoc.range.end)];
				editor.revealRange(item.idLoc.range, vscode.TextEditorRevealType.Default);
			});
		});
	}

	copyNeedID(item: NeedTree): void {
		vscode.env.clipboard.writeText(item.id);
	}

	private watcher(): void {
		// Create file watcher for all relevant needs json files
		const all_curr_needs_jsons = Object.keys(this.needsInfos);
		const watcher = vscode.workspace.createFileSystemWatcher('**/*.json');
		// Watch for file content change
		watcher.onDidChange((uri) => {
			const changed_path = normalizePath(uri.fsPath);
			if (all_curr_needs_jsons.indexOf(changed_path) >= 0) {
				this.needsInfos[changed_path] = this.loadNeedsJsonToInfo(changed_path);
				this._onDidChangeTreeData.fire(undefined);
			}
		});
		// Watch for file create
		watcher.onDidCreate((uri) => {
			const created_path = normalizePath(uri.fsPath);
			if (all_curr_needs_jsons.indexOf(created_path) >= 0) {
				this.needsInfos[created_path] = this.loadNeedsJsonToInfo(created_path);
				this._onDidChangeTreeData.fire(undefined);
			}
		});
	}

	refresh(): void {
		// Reload configurations and all needsJsons, then update tree view
		this.snvConfigs = this.getSNVConfigurations();
		tslogger = new TimeStampedLogger(this.snvConfigs.loggingLevel);
		this.check_wk_configs();
		this.needsInfos = this.loadAllNeedsJsonsToInfos();
		this.onActiveEditorChanged();
		this._onDidChangeTreeData.fire(undefined);
	}

	private onActiveEditorChanged(curr_document = vscode.window.activeTextEditor?.document): void {
		if (curr_document) {
			const curr_doc = normalizePath(curr_document.uri.fsPath);
			// Check if current active editor relevant
			let found_need_info = false;
			let found_need_info_key = '';
			for (const [idx, need_info] of Object.entries(this.needsInfos)) {
				if (need_info?.allFiles && need_info?.allFiles.indexOf(curr_doc) >= 0) {
					found_need_info = true;
					found_need_info_key = idx;
				}
			}

			if (found_need_info) {
				// Copy to keep all needs of needsInfos untouched
				this.needsInfo = { ...this.needsInfos[found_need_info_key] };
				if (this.currEditorView) {
					this.needsInfo.needs = this.needsInfo.needs_per_doc[curr_doc];
				}
			} else if (curr_document.languageId === 'restructuredtext') {
				// Document not known as docname in needs.json, e.g. an included file:
				// use the needs defined in it
				this.needsInfo = this.getNeedsInfoOfDefinedNeeds(curr_document.getText());
			} else {
				this.needsInfo = {
					needs: {},
					allFiles: [],
					src_dir: '',
					needs_json: '',
					needs_per_doc: {}
				};
			}
			this._onDidChangeTreeData.fire(undefined);
		}
	}

	private getNeedsInfoOfDefinedNeeds(docText: string): NeedsInfo {
		// Get IDs of needs defined in given document text, e.g. '   :id: REQ_1'
		const defined_ids = Array.from(docText.matchAll(/^\s*:id:\s+(\S+)\s*$/gm), (match) => match[1]);
		for (const need_info of Object.values(this.needsInfos)) {
			const found_ids = defined_ids.filter((id) => id in need_info.needs);
			if (found_ids.length > 0) {
				if (!this.currEditorView) {
					return { ...need_info };
				}
				const found_needs: Needs = {};
				found_ids.forEach((id) => {
					found_needs[id] = need_info.needs[id];
				});
				return { ...need_info, needs: found_needs };
			}
		}
		return {
			needs: {},
			allFiles: [],
			src_dir: '',
			needs_json: '',
			needs_per_doc: {}
		};
	}

	private listenToChangeConfiguration(): void {
		vscode.workspace.onDidChangeConfiguration(() => {
			let updateTreeData = false;
			const newConfig = this.getSNVConfigurations();

			// Check if loggingLevel changed
			if (this.snvConfigs.loggingLevel !== newConfig.loggingLevel) {
				this.snvConfigs.loggingLevel = newConfig.loggingLevel;
				tslogger = new TimeStampedLogger(this.snvConfigs.loggingLevel);
			}

			// Check if explorerOptions changed
			if (this.snvConfigs.explorerOptions !== newConfig.explorerOptions) {
				this.snvConfigs.explorerOptions = newConfig.explorerOptions;
				updateTreeData = true;
			}

			// Check if explorerItemHoverOptions changed
			if (this.snvConfigs.explorerItemHoverOptions !== newConfig.explorerItemHoverOptions) {
				this.snvConfigs.explorerItemHoverOptions = newConfig.explorerItemHoverOptions;
				updateTreeData = true;
			}

			let reloadNeedsJson = false;
			// Check if needsJson path got changed
			if (this.snvConfigs.needsJson !== newConfig.needsJson) {
				this.snvConfigs.needsJson = newConfig.needsJson;
				reloadNeedsJson = true;
				updateTreeData = true;
				// Update watcher for new needs.json
				this.watcher();
			}

			// Check if srcDir changed
			if (this.snvConfigs.srcDir !== newConfig.srcDir) {
				this.snvConfigs.srcDir = newConfig.srcDir;
				reloadNeedsJson = true;
				updateTreeData = true;
			}

			// Check if folders changed
			if (this.snvConfigs.folders !== newConfig.folders) {
				this.snvConfigs.folders = newConfig.folders;
				reloadNeedsJson = true;
				updateTreeData = true;
			}

			// Check configurations and isMultiDocs
			this.check_wk_configs();
			if (!this.isMultiDocs) {
				updateTreeData = true;
			}

			// Update tree data
			if (updateTreeData) {
				// Reload needsJson to needs infos
				if (reloadNeedsJson) {
					this.needsInfos = this.loadAllNeedsJsonsToInfos();
					// If empty needsInfos, then update needsInfo
					if (Object.keys(this.needsInfos).length <= 0) {
						this.needsInfo = {
							needs: {},
							allFiles: [],
							src_dir: '',
							needs_json: '',
							needs_per_doc: {}
						};
					}
				}
				this._onDidChangeTreeData.fire(undefined);
			}
		});
	}

	getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
		if (!this.needsInfo.needs) {
			return Promise.resolve([]);
		}

		if (!element) {
			// Root level
			return Promise.resolve(this.getNeedTree());
		}

		// Need level: sections of fields, outgoing and incoming links
		if (element instanceof NeedTree && element.id in this.needsInfo.needs) {
			const need = this.needsInfo.needs[element.id];
			return Promise.resolve([
				new NeedSectionItem('Fields', this.getFieldItems(need)),
				new NeedSectionItem('Links Outgoing', this.getLinkItems(need, 'outgoing')),
				new NeedSectionItem('Links Incoming', this.getLinkItems(need, 'incoming'))
			]);
		}

		if (element instanceof NeedSectionItem) {
			return Promise.resolve(element.children);
		}
		return Promise.resolve([]);
	}

	private getFieldItems(need: Need): NeedOptionItem[] {
		// Get and show need options, except links which have their own sections
		const linkTypes = this.getLinkTypes();
		const optionItems: NeedOptionItem[] = [];
		this.snvConfigs.explorerOptions?.forEach((option) => {
			if (linkTypes.includes(option) || linkTypes.includes(option.replace(/_back$/, ''))) {
				return;
			}
			if (option in need) {
				const op_value = (need as unknown as { [option: string]: unknown })[option];
				const value = Array.isArray(op_value) ? op_value.join(', ') : `${op_value ?? ''}`;
				optionItems.push(new NeedOptionItem(option, value));
			} else {
				optionItems.push(new NeedOptionItem(option, 'None'));
				tslogger.warn(`SNV Explorer -> Need option ${option} not exists for ${need.id}.`);
			}
		});
		return optionItems;
	}

	private getLinkTypes(): string[] {
		// Link types are 'links' and each need option with a back links option '<link_type>_back'
		const linkTypes = new Set<string>(['links']);
		Object.values(this.needsInfo.all_needs ?? this.needsInfo.needs).forEach((need) => {
			Object.keys(need).forEach((option) => {
				if (option.endsWith('_back')) {
					linkTypes.add(option.slice(0, -'_back'.length));
				}
			});
		});
		return Array.from(linkTypes);
	}

	private getLinkItems(need: Need, direction: 'outgoing' | 'incoming'): NeedLinkItem[] {
		const allNeeds = this.needsInfo.all_needs ?? this.needsInfo.needs;
		const needOptions = need as unknown as { [option: string]: unknown };
		const linkItems: NeedLinkItem[] = [];
		this.getLinkTypes().forEach((linkType) => {
			let linkedIds: string[] = [];
			if (direction === 'outgoing') {
				linkedIds = Array.isArray(needOptions[linkType]) ? (needOptions[linkType] as string[]) : [];
			} else if (Array.isArray(needOptions[linkType + '_back'])) {
				linkedIds = needOptions[linkType + '_back'] as string[];
			} else {
				// No back links in needs.json, e.g. older Sphinx-Needs versions: calculate them
				linkedIds = Object.values(allNeeds)
					.filter((other) => {
						const otherLinks = (other as unknown as { [option: string]: unknown })[linkType];
						return Array.isArray(otherLinks) && otherLinks.includes(need.id);
					})
					.map((other) => other.id);
			}
			linkedIds.forEach((linkedId) => {
				const linkedNeed = allNeeds[linkedId];
				const linkedLoc = linkedNeed ? this.getNeedLocation(linkedNeed) : undefined;
				linkItems.push(new NeedLinkItem(linkType, linkedId, linkedNeed?.title, direction, linkedLoc));
			});
		});
		return linkItems;
	}

	getTreeItem(element: NeedTree): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	private getSNVConfigurations(): SNVConfig {
		// Get relevant configuration settings
		let needs_json_path: string | undefined = vscode.workspace.getConfiguration('sphinx-needs').get('needsJson');
		let confPyDir: string | undefined = vscode.workspace.getConfiguration('sphinx-needs').get('srcDir');
		const wk_folders: DocConf[] | undefined = vscode.workspace.getConfiguration('sphinx-needs').get('folders');
		const shownNeedOptions: string[] | undefined = vscode.workspace
			.getConfiguration('sphinx-needs')
			.get('explorerOptions');
		const hoverNeedOptions: string[] | undefined = vscode.workspace
			.getConfiguration('sphinx-needs')
			.get('explorerItemHoverOptions');
		let logLevel: LogLevel | undefined = vscode.workspace.getConfiguration('sphinx-needs').get('loggingLevel');
		if (!logLevel) {
			logLevel = 'warn';
		}

		// Replace ${workspaceFolder} from the configurations if needed
		const workspaceFolderpath =
			vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
				? vscode.workspace.workspaceFolders[0].uri.fsPath
				: undefined;
		const conf_folders: DocConf[] = [];
		if (workspaceFolderpath) {
			needs_json_path = resolveConfPath(needs_json_path, workspaceFolderpath);
			confPyDir = resolveConfPath(confPyDir, workspaceFolderpath);
			wk_folders?.forEach((folder) => {
				conf_folders.push({
					needsJson: resolveConfPath(folder.needsJson, workspaceFolderpath) || '',
					srcDir: resolveConfPath(folder.srcDir, workspaceFolderpath) || ''
				});
			});
		} else {
			console.error(`SNV Explorer -> Can't resolve current workspaceFolder path: ${workspaceFolderpath}`);
		}

		return {
			needsJson: needs_json_path,
			srcDir: confPyDir,
			folders: conf_folders,
			explorerOptions: shownNeedOptions,
			explorerItemHoverOptions: hoverNeedOptions,
			loggingLevel: logLevel
		};
	}

	private check_wk_configs() {
		// Check if path exists of needsJson and srcDir
		if (!this.snvConfigs.needsJson) {
			tslogger.warn(`SNV Explorer -> needsJson path not exists: ${this.snvConfigs.needsJson}`);
		} else if (!this.pathExists(this.snvConfigs.needsJson)) {
			tslogger.error(
				`SNV Explorer -> given sphinx-needs.needsJson path not exists: ${this.snvConfigs.needsJson}`
			);
		}

		if (!this.snvConfigs.srcDir) {
			tslogger.warn('SNV Explorer -> sphinx-needs.srcDir is empty or undefined');
		} else if (!this.pathExists(this.snvConfigs.srcDir)) {
			tslogger.error(`SNV Explorer -> given sphinx-needs.srcDir path not exists: ${this.snvConfigs.srcDir}`);
		}

		// Check if path of needsJson and srcDir from sphinx-needs.folders exist
		if (this.snvConfigs.folders.length <= 0) {
			this.isMultiDocs = false;
		} else {
			this.snvConfigs.folders.forEach((fd) => {
				if (!fd.needsJson) {
					tslogger.warn('SNV Explorer -> needsJson empty or undefined in sphinx-needs.folders');
				} else if (!this.pathExists(fd.needsJson)) {
					tslogger.error(
						`SNV Explorer -> needsJson path in sphinx-needs.folders not exists: ${fd.needsJson}`
					);
				}
				if (!fd.srcDir) {
					tslogger.warn('SNV Explorer -> srcDir empty or undefined in sphinx-needs.folders');
				} else if (!this.pathExists(fd.srcDir)) {
					tslogger.error(`SNV Explorer -> srcDir path in sphinx-needs.folders not exists: ${fd.srcDir}`);
				}
			});
			this.isMultiDocs = true;
		}
	}

	private loadAllNeedsJsonsToInfos(): NeedsInfos {
		const all_needs_infos: NeedsInfos = {};
		// Load needsJson from sphinx-needs.folders
		this.snvConfigs.folders.forEach((fd) => {
			if (!(fd.needsJson in all_needs_infos)) {
				all_needs_infos[fd.needsJson] = this.loadNeedsJsonToInfo(fd.needsJson);
			} else {
				tslogger.warn('SNV Explorer -> Duplicate needsJson config in sphinx-needs.folders');
			}
		});
		// Load sphinx-needs.needsJson
		if (this.snvConfigs.needsJson && this.snvConfigs.srcDir && !(this.snvConfigs.needsJson in all_needs_infos)) {
			all_needs_infos[this.snvConfigs.needsJson] = this.loadNeedsJsonToInfo(this.snvConfigs.needsJson);
		}
		return all_needs_infos;
	}

	private loadNeedsJsonToInfo(needsJsonFilePath: string | undefined): NeedsInfo {
		// Check needs.json path and get needs object from needs.json if exists
		if (needsJsonFilePath && this.pathExists(needsJsonFilePath)) {
			tslogger.debug(`SNV Explorer -> Loaded nedds json: ${needsJsonFilePath}`);

			// Read needs.json
			const needsJson = JSON.parse(fs.readFileSync(needsJsonFilePath, 'utf-8'));

			// Get needs objects from current_version
			const curr_version: string = needsJson['current_version'];
			const needs_objects: Needs = needsJson['versions'][curr_version]['needs'];

			// Check and get doctype for nested child needs
			for (const need of Object.values(needs_objects)) {
				// Newer Sphinx-Needs versions export the need content as 'content' instead of 'description'
				if (need.description === undefined) {
					need.description = need.content ?? '';
				}

				let temp_parent_id: string;
				let temp_parent: Need;
				// Get child need
				if (!need['doctype'] && need['parent_need']) {
					// search up to top parent need to get info of doctype
					temp_parent_id = need['parent_need'];
					temp_parent = needs_objects[temp_parent_id];
					while (temp_parent['parent_need']) {
						if (!temp_parent['parent_need']) {
							break;
						}
						temp_parent = needs_objects[temp_parent['parent_need']];
					}
					need['doctype'] = temp_parent['doctype'];
				}
			}

			// Get current srcDir
			let curr_src_dir = '';
			if (this.snvConfigs.needsJson === needsJsonFilePath) {
				if (this.snvConfigs.srcDir) {
					curr_src_dir = this.snvConfigs.srcDir;
				}
			} else {
				this.snvConfigs.folders?.forEach((fd) => {
					if (fd.needsJson === needsJsonFilePath) {
						curr_src_dir = fd.srcDir;
					}
				});
			}

			// Calculate all files paths in current srcDir and needs_per_doc
			const all_files_path: string[] = [];
			let need_doc_path: string;
			const needs_per_doc: NeedsPerDoc = {};
			Object.values(needs_objects).forEach((nd) => {
				need_doc_path = normalizePath(path.join(curr_src_dir, nd.docname + nd.doctype));

				if (all_files_path.indexOf(need_doc_path) === -1) {
					all_files_path.push(need_doc_path);
				}

				// Calculate needs objects per doc
				if (!(need_doc_path in needs_per_doc)) {
					needs_per_doc[need_doc_path] = {};
				}
				if (!(nd.id in needs_per_doc[need_doc_path])) {
					needs_per_doc[need_doc_path][nd.id] = nd;
				}
			});

			const needs_info: NeedsInfo = {
				needs: needs_objects,
				all_needs: needs_objects,
				allFiles: all_files_path,
				src_dir: curr_src_dir,
				needs_json: needsJsonFilePath,
				needs_per_doc: needs_per_doc
			};
			return needs_info;
		}
		return {
			needs: {},
			allFiles: [],
			src_dir: '',
			needs_json: '',
			needs_per_doc: {}
		};
	}

	private getNeedFilePath(need: Need): vscode.Uri {
		// Get file path of current need
		const curr_need: Need = need;

		// Check if docname and doctype exist in need object
		if (!('docname' in curr_need)) {
			tslogger.warn(`SNV Explorer -> Option docname not exists in Need ${curr_need}`);
			return vscode.Uri.file('');
		}
		if (!('doctype' in curr_need)) {
			tslogger.warn(`SNV Explorer -> Option doctype not exists in Need ${curr_need}`);
			return vscode.Uri.file('');
		}

		// Calculate doc path uri for current need
		let curr_need_file_path = '';
		if (this.needsInfo.src_dir) {
			curr_need_file_path = path.resolve(this.needsInfo.src_dir, curr_need.docname + curr_need.doctype);
			if (!this.pathExists(curr_need_file_path)) {
				tslogger.warn(`SNV Explorer -> doc path for Need ${need.id} not exists: ${curr_need_file_path}`);
			} else {
				// Need may be defined in a file included by its docname file
				curr_need_file_path =
					findNeedSourceFile(curr_need_file_path, curr_need.id, this.needsInfo.src_dir) ?? curr_need_file_path;
			}
		}
		const needFileUri: vscode.Uri = vscode.Uri.file(curr_need_file_path);
		return needFileUri;
	}

	private getNeedLocation(need: Need): vscode.Location {
		// Get need ID Definition Location
		const needFileUri = this.getNeedFilePath(need);
		let needIDPos;
		try {
			needIDPos = findDefinition(need, needFileUri);
		} catch (err) {
			tslogger.error(`SNV Explorer -> No Need ID defintion found for ${need['id']}.`);
		}
		if (!needIDPos) {
			needIDPos = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
		}
		return new vscode.Location(needFileUri, needIDPos);
	}

	private getNeedTree(): NeedTree[] {
		const needsItems: NeedTree[] = [];
		if (this.needsInfo.needs) {
			Object.values(this.needsInfo.needs).forEach((need) => {
				// Check if Need ID matches Need Objects key entry
				if (!(need['id'] in this.needsInfo.needs)) {
					tslogger.warn(`SNV Explorer -> Need object entry of ${need.id} not exits in given needs.json`);
				} else {
					// Calculate needed hoverOptionsValues for hover over item
					const hoverOptionValues: string[] = [];
					this.snvConfigs.explorerItemHoverOptions?.forEach((op) => {
						if (!(op in need)) {
							tslogger.warn(`SNV Explorer -> given need option ${op} not exists.`);
						} else {
							for (const [key, value] of Object.entries(need)) {
								if (op === key && value && value.length) {
									hoverOptionValues.push(op + ': ' + value);
								}
							}
						}
					});
					// Get need ID Definition Location
					const needIDLoc = this.getNeedLocation(need);

					const needItem = new NeedTree(
						need['id'],
						need['title'],
						need['description'],
						hoverOptionValues,
						needIDLoc,
						vscode.TreeItemCollapsibleState.Collapsed
					);
					needsItems.push(needItem);
				}
			});
			return needsItems;
		} else {
			return [];
		}
	}

	private pathExists(p: string): boolean {
		try {
			fs.accessSync(p);
		} catch (err) {
			return false;
		}
		return true;
	}
}

class NeedTree extends vscode.TreeItem {
	constructor(
		public readonly id: string,
		private title: string,
		private content: string,
		private hoverOptions: string[],
		public readonly idLoc: vscode.Location,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(id, collapsibleState);
		let hoverContents = `**${this.title}**\n\n\`\`\`\n${this.content}\n\`\`\`\n\n`;
		if (this.hoverOptions) {
			this.hoverOptions.forEach((op) => {
				hoverContents = hoverContents.concat(
					`&nbsp;<span style="color:#ffffff;background-color:#0078d4;">&nbsp;&nbsp;${op}&nbsp;&nbsp;</span>&nbsp;`
				);
			});
		}
		this.tooltip = new vscode.MarkdownString(hoverContents, true);
		this.tooltip.supportHtml = true;
		this.description = this.title;
	}

	contextValue = 'needID';
}

class NeedSectionItem extends vscode.TreeItem {
	constructor(label: string, public readonly children: vscode.TreeItem[]) {
		super(
			label,
			children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
		);
		this.description = children.length > 0 ? '' : 'none';
	}
}

class NeedOptionItem extends vscode.TreeItem {
	constructor(option: string, value: string) {
		super(option, vscode.TreeItemCollapsibleState.None);
		this.description = value;
		this.tooltip = new vscode.MarkdownString(`**${option}**: ${value}`, true);
		this.iconPath = new vscode.ThemeIcon('circle-small-filled');
	}
}

class NeedLinkItem extends vscode.TreeItem {
	constructor(
		linkType: string,
		public readonly linkedId: string,
		linkedTitle: string | undefined,
		direction: 'outgoing' | 'incoming',
		public readonly idLoc: vscode.Location | undefined
	) {
		super(linkType, vscode.TreeItemCollapsibleState.None);
		this.description = linkedId;
		this.tooltip = new vscode.MarkdownString(
			linkedTitle ? `**${linkedId}**: ${linkedTitle}` : `**${linkedId}**: not found in needs.json`,
			true
		);
		this.iconPath = new vscode.ThemeIcon(direction === 'outgoing' ? 'arrow-circle-right' : 'arrow-circle-left');
		if (this.idLoc) {
			// Jump to linked need on click
			this.command = {
				command: 'sphinxNeedsExplorer.gotoDef',
				title: 'Goto Definition',
				arguments: [this]
			};
		}
	}
}

function findDefinition(need: Need, fileUri: vscode.Uri): vscode.Range | undefined {
	// Return definition location of given Need ID

	// Read the document where Need ID is at
	const doc_contents = read_need_doc_contents(fileUri);
	if (!doc_contents) {
		return;
	}

	// Get location of need directive definition line index, e.g. .. req::
	const need_directive_location = find_directive_definition(doc_contents, need);
	if (!need_directive_location) {
		return;
	}

	const id_line_idx = doc_contents.findIndex((line) => isNeedIdLine(line, need['id']));
	const startIdxID = doc_contents[id_line_idx].indexOf(need['id']);
	const endIdxID = startIdxID + need['id'].length;
	const startPos = new vscode.Position(id_line_idx, startIdxID);
	const endPos = new vscode.Position(id_line_idx, endIdxID);

	return new vscode.Range(startPos, endPos);
}

// Check if given line defines given need ID, e.g. '   :id: REQ_1' (but not REQ_10)
function isNeedIdLine(line: string, needId: string): boolean {
	const escapedId = needId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^\\s*:id:\\s+${escapedId}\\s*$`).test(line);
}

// Find the file where given need is actually defined.
// needs.json only gives the docname of the including document, so follow '.. include::' directives.
function findNeedSourceFile(
	docPath: string,
	needId: string,
	srcDir: string,
	visited: Set<string> = new Set()
): string | undefined {
	const normalizedDocPath = normalizePath(docPath);
	if (visited.has(normalizedDocPath)) {
		return undefined;
	}
	visited.add(normalizedDocPath);

	let docContents: string[];
	try {
		docContents = fs.readFileSync(docPath, 'utf8').split('\n');
	} catch (err) {
		return undefined;
	}
	if (docContents.some((line) => isNeedIdLine(line, needId))) {
		return docPath;
	}

	for (const line of docContents) {
		const includeMatch = line.match(/^\s*\.\.\s+include::\s*(.+?)\s*$/);
		// Skip standard docutils includes, e.g. <isonum.txt>
		if (!includeMatch || includeMatch[1].startsWith('<')) {
			continue;
		}
		const includePath = includeMatch[1];
		// Absolute include paths are relative to the Sphinx source directory
		const includedDocPath = includePath.startsWith('/')
			? path.join(srcDir, includePath)
			: path.resolve(path.dirname(docPath), includePath);
		const found = findNeedSourceFile(includedDocPath, needId, srcDir, visited);
		if (found) {
			return found;
		}
	}
	return undefined;
}

function read_need_doc_contents(fileUri: vscode.Uri): string[] | null {
	try {
		const doc_content: string = fs.readFileSync(fileUri.fsPath, 'utf8');
		const doc_content_lines = doc_content.split('\n');
		return doc_content_lines;
	} catch (err) {
		tslogger.error(`SNV Explorer -> Error read docoment: ${err}`);
	}
	return null;
}

function find_directive_definition(doc_content_lines: string[], curr_need: Need): number | null {
	// Get line of need id definition with pattern {:id: need_id}
	const found_id_line_idx = doc_content_lines.findIndex((line) => isNeedIdLine(line, curr_need.id));
	if (found_id_line_idx === -1) {
		tslogger.error(`SNV Explorer -> No defintion found of ${curr_need.id}.`);
		return null;
	}

	// Get line of directive with pattern {.. {need_type}::}
	const directive_pattern = `.. ${curr_need.type}::`;
	// Get lines before id_line_idx to find the line of directive
	const new_doc_content_lines = doc_content_lines.slice(0, found_id_line_idx);
	const found_reverse_directive_line_idx = new_doc_content_lines
		.reverse()
		.findIndex((line) => line.indexOf(directive_pattern) !== -1);
	if (found_reverse_directive_line_idx === -1) {
		tslogger.error(`SNV Explorer -> No defintion found of ${curr_need.id}.`);
		return null;
	}
	const found_directive_line_idx = new_doc_content_lines.length - 1 - found_reverse_directive_line_idx;
	return found_directive_line_idx;
}
