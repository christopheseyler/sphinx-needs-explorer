'use strict';

import * as vscode from 'vscode';
import { NeedsGraphSource, getLinkedIds } from './needsExplorer';

interface GraphNode {
	id: string;
	title: string;
	type: string;
	status: string;
	tags: string[];
	// Distance to the focused need: negative for needs linking to it, positive for needs linked by it
	level: number;
	// Linked need not found in needs.json
	missing: boolean;
	// Amount of links not shown beyond max distance
	more: number;
}

interface GraphEdge {
	from: string;
	to: string;
	type: string;
}

interface Graph {
	focus: string;
	maxDistance: number;
	nodes: GraphNode[];
	edges: GraphEdge[];
}

const DEFAULT_MAX_DISTANCE = 2;
const MAX_DISTANCE_LIMIT = 10;

let graphPanel: vscode.WebviewPanel | undefined;
let graphSource: NeedsGraphSource | undefined;
let graphFocus = '';
let graphMaxDistance = DEFAULT_MAX_DISTANCE;

// Show the links graph of given need: needs linked by it above, needs linking to it below
export function showNeedsGraph(source: NeedsGraphSource, needId: string): void {
	graphSource = source;
	graphFocus = needId;

	if (!graphPanel) {
		graphPanel = vscode.window.createWebviewPanel(
			'sphinxNeedsLinksGraph',
			'Needs links',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		graphPanel.webview.html = getGraphHtml();
		graphPanel.webview.onDidReceiveMessage((message) => onGraphMessage(message));
		graphPanel.onDidDispose(() => {
			graphPanel = undefined;
		});
	} else {
		graphPanel.reveal(undefined, false);
	}
	postGraph();
}

function onGraphMessage(message: { type: string; id?: string; value?: number }): void {
	if (!graphSource) {
		return;
	}
	if (message.type === 'ready') {
		postGraph();
	} else if (message.type === 'distance' && typeof message.value === 'number') {
		graphMaxDistance = Math.min(Math.max(Math.round(message.value), 1), MAX_DISTANCE_LIMIT);
		postGraph();
	} else if (message.type === 'focus' && message.id) {
		graphFocus = message.id;
		postGraph();
	} else if (message.type === 'open' && message.id) {
		// Jump to the definition of the need, next to the graph
		const location = graphSource.locate(message.id);
		if (location && location.uri.fsPath.length > 1) {
			vscode.window.showTextDocument(location.uri, {
				viewColumn: vscode.ViewColumn.One,
				selection: location.range
			});
		} else {
			vscode.window.showWarningMessage(`SNV: No definition found for ${message.id}.`);
		}
	}
}

function postGraph(): void {
	if (!graphPanel || !graphSource) {
		return;
	}
	graphPanel.title = `Needs links: ${graphFocus}`;
	graphPanel.webview.postMessage({ type: 'graph', graph: buildGraph(graphSource, graphFocus, graphMaxDistance) });
}

export function buildGraph(source: NeedsGraphSource, focusId: string, maxDistance: number): Graph {
	const levels = new Map<string, number>([[focusId, 0]]);
	const more = new Map<string, number>();

	// Walk links from the focused need, level by level, in one direction
	const walk = (direction: 'outgoing' | 'incoming', sign: number) => {
		const getLinked = (needId: string): string[] => {
			const need = source.allNeeds[needId];
			if (!need) {
				return [];
			}
			return source.linkTypes.flatMap((linkType) => getLinkedIds(need, linkType, direction, source.allNeeds));
		};
		let frontier = [focusId];
		for (let distance = 1; distance <= maxDistance; distance++) {
			const next: string[] = [];
			frontier.forEach((needId) => {
				getLinked(needId).forEach((linkedId) => {
					if (!levels.has(linkedId)) {
						levels.set(linkedId, sign * distance);
						next.push(linkedId);
					}
				});
			});
			frontier = next;
		}
		// Count links going beyond max distance
		frontier.forEach((needId) => {
			const hidden = new Set(getLinked(needId).filter((linkedId) => !levels.has(linkedId)));
			if (hidden.size > 0) {
				more.set(needId, hidden.size);
			}
		});
	};
	walk('outgoing', 1);
	walk('incoming', -1);

	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const edgeKeys = new Set<string>();
	levels.forEach((level, needId) => {
		const need = source.allNeeds[needId];
		nodes.push({
			id: needId,
			title: need?.title ?? '',
			type: need?.type ?? '',
			status: need?.status ?? '',
			tags: need?.tags ?? [],
			level: level,
			missing: !need,
			more: more.get(needId) ?? 0
		});
		if (!need) {
			return;
		}
		source.linkTypes.forEach((linkType) => {
			getLinkedIds(need, linkType, 'outgoing', source.allNeeds).forEach((linkedId) => {
				const edgeKey = `${needId}|${linkedId}|${linkType}`;
				if (levels.has(linkedId) && !edgeKeys.has(edgeKey)) {
					edgeKeys.add(edgeKey);
					edges.push({ from: needId, to: linkedId, type: linkType });
				}
			});
		});
	});

	return { focus: focusId, maxDistance: maxDistance, nodes: nodes, edges: edges };
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}

export function getGraphHtml(): string {
	const nonce = getNonce();
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Needs links</title>
<style nonce="${nonce}">
	body {
		margin: 0;
		padding: 0;
		color: var(--vscode-foreground);
		background: var(--vscode-editor-background);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
	}
	#toolbar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 8px 16px;
		padding: 8px 16px;
		background: var(--vscode-editorWidget-background);
		border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
	}
	#distance,
	#zoom {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	#toolbar button {
		width: 26px;
		height: 26px;
		border: none;
		border-radius: 3px;
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
	}
	#toolbar button:hover {
		background: var(--vscode-button-hoverBackground);
	}
	#toolbar button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	#legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		color: var(--vscode-descriptionForeground);
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.swatch {
		display: inline-block;
		width: 14px;
		height: 3px;
		border-radius: 2px;
	}
	#hint {
		color: var(--vscode-descriptionForeground);
	}
	#canvas {
		position: relative;
		margin: 0 auto;
	}
	#edges {
		position: absolute;
		left: 0;
		top: 0;
		pointer-events: none;
	}
	.edge {
		fill: none;
		stroke-width: 1.6;
	}
	.edge-label {
		font-size: 11px;
		text-anchor: middle;
		paint-order: stroke;
		stroke: var(--vscode-editor-background);
		stroke-width: 4px;
		stroke-linejoin: round;
	}
	.card {
		position: absolute;
		box-sizing: border-box;
		padding: 8px 10px;
		border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
		border-right-width: 5px;
		border-radius: 4px;
		background: var(--vscode-editorWidget-background);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
	}
	.card.focus {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}
	.card.missing {
		border-style: dashed;
		opacity: 0.75;
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.card-id {
		font-weight: 600;
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.card-title {
		margin: 2px 0 6px 0;
		font-weight: 600;
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.card-id:hover,
	.card-title:hover {
		color: var(--vscode-textLink-activeForeground);
		text-decoration: underline;
	}
	.card-center {
		flex: none;
		padding: 0 4px;
		border: none;
		border-radius: 3px;
		cursor: pointer;
		font-size: 14px;
		color: var(--vscode-descriptionForeground);
		background: transparent;
	}
	.card-center:hover {
		color: var(--vscode-foreground);
		background: var(--vscode-toolbar-hoverBackground);
	}
	.card-field {
		display: flex;
		gap: 8px;
		font-size: 11px;
		line-height: 1.5;
	}
	.card-key {
		flex: none;
		width: 44px;
		color: var(--vscode-descriptionForeground);
	}
	.card-value {
		overflow-wrap: anywhere;
	}
	.card-more {
		margin-top: 4px;
		font-size: 11px;
		font-style: italic;
		color: var(--vscode-descriptionForeground);
	}
</style>
</head>
<body>
<div id="toolbar">
	<div id="distance">
		<button id="minus" title="Decrease max distance">&minus;</button>
		<span id="distance-label">maxDistance: ${DEFAULT_MAX_DISTANCE}</span>
		<button id="plus" title="Increase max distance">+</button>
	</div>
	<div id="zoom">
		<button id="zoom-out" title="Zoom out (Ctrl + mouse wheel)">&minus;</button>
		<span id="zoom-label">zoom: 100%</span>
		<button id="zoom-in" title="Zoom in (Ctrl + mouse wheel)">+</button>
	</div>
	<div id="legend"></div>
	<div id="hint">Click a need to open it &middot; &#9678; centers the graph on it</div>
</div>
<div id="canvas">
	<svg id="edges" xmlns="http://www.w3.org/2000/svg"></svg>
	<div id="nodes"></div>
</div>
<script nonce="${nonce}">
(function () {
	var vscode = acquireVsCodeApi();
	var SVG_NS = 'http://www.w3.org/2000/svg';
	var CARD_W = 230;
	var H_GAP = 34;
	var V_GAP = 96;
	var PAD = 40;
	var LINE_GAP = 56;
	var MAX_PER_LINE = 8;
	var MAX_DISTANCE_LIMIT = ${MAX_DISTANCE_LIMIT};

	var canvas = document.getElementById('canvas');
	var svg = document.getElementById('edges');
	var nodesEl = document.getElementById('nodes');
	var legendEl = document.getElementById('legend');
	var distanceLabel = document.getElementById('distance-label');
	var minus = document.getElementById('minus');
	var plus = document.getElementById('plus');
	var toolbar = document.getElementById('toolbar');
	var zoomLabel = document.getElementById('zoom-label');
	var graph = null;
	var zoom = 1;

	function applyZoom() {
		canvas.style.zoom = zoom;
		zoomLabel.textContent = 'zoom: ' + Math.round(zoom * 100) + '%';
	}
	function setZoom(value) {
		// Keep the center of the view at the same place of the graph
		var centerX = (window.scrollX + window.innerWidth / 2) / zoom;
		var centerY = (window.scrollY + window.innerHeight / 2) / zoom;
		zoom = Math.min(Math.max(value, 0.2), 2);
		applyZoom();
		window.scrollTo(centerX * zoom - window.innerWidth / 2, centerY * zoom - window.innerHeight / 2);
	}

	function hue(text) {
		var hash = 0;
		for (var i = 0; i < text.length; i++) {
			hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
		}
		return hash % 360;
	}
	function typeColor(type) {
		return 'hsl(' + hue('type:' + type) + ', 65%, 55%)';
	}
	function linkColor(linkType) {
		return 'hsl(' + hue('link:' + linkType) + ', 55%, 62%)';
	}
	function el(tag, className, text) {
		var element = document.createElement(tag);
		if (className) {
			element.className = className;
		}
		if (text !== undefined) {
			element.textContent = text;
		}
		return element;
	}
	function svgEl(tag, attributes) {
		var element = document.createElementNS(SVG_NS, tag);
		Object.keys(attributes).forEach(function (name) {
			element.setAttribute(name, attributes[name]);
		});
		return element;
	}

	function createCard(node) {
		var card = el('div', 'card' + (node.id === graph.focus ? ' focus' : '') + (node.missing ? ' missing' : ''));
		card.style.width = CARD_W + 'px';
		card.style.borderRightColor = node.missing ? '' : typeColor(node.type);

		var head = el('div', 'card-head');
		var id = el('span', 'card-id', node.id);
		id.title = 'Open ' + node.id;
		head.appendChild(id);
		if (!node.missing && node.id !== graph.focus) {
			var center = el('button', 'card-center', '\\u25CE');
			center.title = 'Center the graph on ' + node.id;
			center.addEventListener('click', function () {
				vscode.postMessage({ type: 'focus', id: node.id });
			});
			head.appendChild(center);
		}
		card.appendChild(head);

		var title = el('div', 'card-title', node.missing ? '(not found in needs.json)' : node.title);
		card.appendChild(title);
		if (!node.missing) {
			[id, title].forEach(function (element) {
				element.addEventListener('click', function () {
					vscode.postMessage({ type: 'open', id: node.id });
				});
			});
		}

		[
			['status', node.status],
			['type', node.type],
			['tags', node.tags.join(', ')]
		].forEach(function (field) {
			if (field[1]) {
				var row = el('div', 'card-field');
				row.appendChild(el('span', 'card-key', field[0]));
				row.appendChild(el('span', 'card-value', field[1]));
				card.appendChild(row);
			}
		});
		if (node.more > 0) {
			card.appendChild(el('div', 'card-more', '+' + node.more + ' more link' + (node.more > 1 ? 's' : '')));
		}
		return card;
	}

	function orderRows(rows) {
		// Order needs of each level by the position of their linked needs in the level closer to the focus
		var levelOf = {};
		graph.nodes.forEach(function (node) {
			levelOf[node.id] = node.level;
		});
		var neighbors = {};
		graph.edges.forEach(function (edge) {
			(neighbors[edge.from] = neighbors[edge.from] || []).push(edge.to);
			(neighbors[edge.to] = neighbors[edge.to] || []).push(edge.from);
		});
		var position = {};
		var setPositions = function (row) {
			row.forEach(function (node, i) {
				position[node.id] = (i + 0.5) / row.length;
			});
		};
		if (rows[0]) {
			setPositions(rows[0]);
		}
		var orderRow = function (level, innerLevel) {
			var row = rows[level];
			if (!row) {
				return;
			}
			var key = {};
			row.forEach(function (node, i) {
				var inner = (neighbors[node.id] || []).filter(function (id) {
					return levelOf[id] === innerLevel;
				});
				key[node.id] = inner.length
					? inner.reduce(function (sum, id) {
							return sum + position[id];
					  }, 0) / inner.length
					: (i + 0.5) / row.length;
			});
			row.sort(function (a, b) {
				return key[a.id] - key[b.id] || a.id.localeCompare(b.id);
			});
			setPositions(row);
		};
		for (var distance = 1; distance <= graph.maxDistance; distance++) {
			orderRow(distance, distance - 1);
			orderRow(-distance, -(distance - 1));
		}
	}

	function render() {
		nodesEl.textContent = '';
		while (svg.lastChild) {
			svg.removeChild(svg.lastChild);
		}
		// Cards are measured without zoom
		canvas.style.zoom = 1;
		legendEl.textContent = '';
		distanceLabel.textContent = 'maxDistance: ' + graph.maxDistance;
		minus.disabled = graph.maxDistance <= 1;
		plus.disabled = graph.maxDistance >= MAX_DISTANCE_LIMIT;

		// Needs per level, from needs linked by the focus (top, e.g. higher level specifications)
		// to needs linking to it (bottom, e.g. implementations and tests)
		var rows = {};
		graph.nodes.forEach(function (node) {
			(rows[node.level] = rows[node.level] || []).push(node);
		});
		orderRows(rows);
		var levels = Object.keys(rows)
			.map(Number)
			.sort(function (a, b) {
				return b - a;
			});

		// Levels with many needs are wrapped on several lines, shifted by half a card
		// so that links of a line pass between the cards of the next one
		var lines = [];
		levels.forEach(function (level) {
			var row = rows[level];
			var lineCount = Math.ceil(row.length / MAX_PER_LINE);
			var perLine = Math.ceil(row.length / lineCount);
			for (var i = 0; i < lineCount; i++) {
				lines.push({
					nodes: row.slice(i * perLine, (i + 1) * perLine),
					shift: lineCount > 1 && i % 2 === 1 ? (CARD_W + H_GAP) / 2 : 0,
					lastOfLevel: i === lineCount - 1
				});
			}
		});
		var lineWidth = function (line) {
			return line.nodes.length * (CARD_W + H_GAP) - H_GAP + line.shift;
		};
		var maxLineWidth = 0;
		lines.forEach(function (line) {
			maxLineWidth = Math.max(maxLineWidth, lineWidth(line));
		});
		var width = maxLineWidth + 2 * PAD;

		// Place cards
		var box = {};
		var y = PAD;
		var lastGap = 0;
		lines.forEach(function (line) {
			var x = (width - lineWidth(line)) / 2 + line.shift;
			var lineHeight = 0;
			line.nodes.forEach(function (node) {
				var card = createCard(node);
				card.style.left = x + 'px';
				card.style.top = y + 'px';
				nodesEl.appendChild(card);
				box[node.id] = { x: x, y: y, w: CARD_W, h: card.offsetHeight, card: card };
				lineHeight = Math.max(lineHeight, card.offsetHeight);
				x += CARD_W + H_GAP;
			});
			lastGap = line.lastOfLevel ? V_GAP : LINE_GAP;
			y += lineHeight + lastGap;
		});
		var height = y - lastGap + PAD;
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';
		svg.setAttribute('width', width);
		svg.setAttribute('height', height);

		// Arrow heads and legend per link type
		var linkTypes = [];
		graph.edges.forEach(function (edge) {
			if (linkTypes.indexOf(edge.type) === -1) {
				linkTypes.push(edge.type);
			}
		});
		var defs = svgEl('defs', {});
		linkTypes.forEach(function (linkType, i) {
			var marker = svgEl('marker', {
				id: 'arrow-' + i,
				viewBox: '0 0 10 10',
				refX: '9',
				refY: '5',
				markerWidth: '7',
				markerHeight: '7',
				orient: 'auto-start-reverse'
			});
			marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: linkColor(linkType) }));
			defs.appendChild(marker);

			var item = el('span', 'legend-item');
			var swatch = el('span', 'swatch');
			swatch.style.background = linkColor(linkType);
			item.appendChild(swatch);
			item.appendChild(el('span', '', linkType));
			legendEl.appendChild(item);
		});
		svg.appendChild(defs);

		// Sides of the cards used by each link, to spread the links along the card sides
		var ports = {};
		var links = graph.edges
			.filter(function (edge) {
				return box[edge.from] && box[edge.to];
			})
			.map(function (edge) {
				var from = box[edge.from];
				var to = box[edge.to];
				var link = { edge: edge, from: from, to: to };
				if (from.y < to.y) {
					link.fromSide = 'bottom';
					link.toSide = 'top';
				} else if (from.y > to.y) {
					link.fromSide = 'top';
					link.toSide = 'bottom';
				} else {
					link.fromSide = 'bottom';
					link.toSide = 'bottom';
				}
				var fromKey = edge.from + '|' + link.fromSide;
				var toKey = edge.to + '|' + link.toSide;
				(ports[fromKey] = ports[fromKey] || []).push({ link: link, end: 'from', other: to });
				(ports[toKey] = ports[toKey] || []).push({ link: link, end: 'to', other: from });
				return link;
			});
		Object.keys(ports).forEach(function (key) {
			var port = ports[key];
			port.sort(function (a, b) {
				return a.other.x - b.other.x;
			});
			port.forEach(function (entry, i) {
				var card = entry.end === 'from' ? entry.link.from : entry.link.to;
				var side = entry.end === 'from' ? entry.link.fromSide : entry.link.toSide;
				entry.link[entry.end + 'Point'] = {
					x: card.x + (card.w * (i + 1)) / (port.length + 1),
					y: side === 'top' ? card.y : card.y + card.h
				};
			});
		});

		// Draw links: from the need which links to the linked need
		links.forEach(function (link) {
			var p1 = link.fromPoint;
			var p2 = link.toPoint;
			var bend = Math.max(36, Math.abs(p2.y - p1.y) / 2);
			var c1 = { x: p1.x, y: p1.y + (link.fromSide === 'bottom' ? bend : -bend) };
			var c2 = { x: p2.x, y: p2.y + (link.toSide === 'bottom' ? bend : -bend) };
			var color = linkColor(link.edge.type);
			svg.appendChild(
				svgEl('path', {
					class: 'edge',
					d: 'M ' + p1.x + ' ' + p1.y + ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + p2.x + ' ' + p2.y,
					stroke: color,
					'marker-end': 'url(#arrow-' + linkTypes.indexOf(link.edge.type) + ')'
				})
			);
			// Label in the middle of the curve
			var label = svgEl('text', {
				class: 'edge-label',
				x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
				y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 + 4,
				fill: color
			});
			label.textContent = link.edge.type;
			svg.appendChild(label);
		});

		// Keep the graph below the toolbar and bring the focused need into view
		canvas.style.marginTop = toolbar.offsetHeight + 'px';
		applyZoom();
		if (box[graph.focus]) {
			box[graph.focus].card.scrollIntoView({ block: 'center', inline: 'center' });
		}
	}

	document.getElementById('zoom-out').addEventListener('click', function () {
		setZoom(zoom / 1.2);
	});
	document.getElementById('zoom-in').addEventListener('click', function () {
		setZoom(zoom * 1.2);
	});
	window.addEventListener(
		'wheel',
		function (event) {
			if (event.ctrlKey) {
				event.preventDefault();
				setZoom(event.deltaY < 0 ? zoom * 1.1 : zoom / 1.1);
			}
		},
		{ passive: false }
	);
	window.addEventListener('resize', function () {
		canvas.style.marginTop = toolbar.offsetHeight + 'px';
	});

	minus.addEventListener('click', function () {
		if (graph) {
			vscode.postMessage({ type: 'distance', value: graph.maxDistance - 1 });
		}
	});
	plus.addEventListener('click', function () {
		if (graph) {
			vscode.postMessage({ type: 'distance', value: graph.maxDistance + 1 });
		}
	});
	window.addEventListener('message', function (event) {
		if (event.data && event.data.type === 'graph') {
			graph = event.data.graph;
			render();
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
