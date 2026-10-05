/**
 * XML laid out for reading. Machines write it on one line; a person
 * reads it indented. Only files that parse, and that are not already
 * laid out, are touched: anything else is shown exactly as saved.
 */

const INDENT = "  ";
/** Lines shorter than this on average mean somebody already indented it. */
const LAID_OUT_BELOW = 200;

function alreadyLaidOut(raw: string): boolean {
	let lines = 1;
	for (let i = raw.indexOf("\n"); i !== -1; i = raw.indexOf("\n", i + 1))
		lines++;
	return raw.length / lines < LAID_OUT_BELOW;
}

const escapeText = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Tags are written from the names and attributes as the file gave
// them. (The platform's serializer repeats namespace declarations on
// every element it is handed on its own.)
function openTag(el: Element, selfClose = false): string {
	let tag = `<${el.tagName}`;
	for (const a of Array.from(el.attributes))
		tag += ` ${a.name}="${escapeText(a.value).replace(/"/g, "&quot;")}"`;
	return tag + (selfClose ? "/>" : ">");
}

/** A node and everything in it, on one line. */
function inline(node: Node): string {
	switch (node.nodeType) {
		case Node.ELEMENT_NODE: {
			const el = node as Element;
			if (!el.childNodes.length) return openTag(el, true);
			const inner = Array.from(el.childNodes).map(inline).join("");
			return `${openTag(el)}${inner}</${el.tagName}>`;
		}
		case Node.TEXT_NODE:
			return escapeText(node.nodeValue ?? "");
		case Node.CDATA_SECTION_NODE:
			return `<![CDATA[${node.nodeValue ?? ""}]]>`;
		case Node.COMMENT_NODE:
			return `<!--${node.nodeValue ?? ""}-->`;
		case Node.PROCESSING_INSTRUCTION_NODE:
			return `<?${(node as ProcessingInstruction).target} ${node.nodeValue ?? ""}?>`;
		default:
			return new XMLSerializer().serializeToString(node);
	}
}

const isBlank = (node: Node) =>
	node.nodeType === Node.TEXT_NODE && !(node.nodeValue ?? "").trim();

function write(node: Node, depth: number, out: string[]) {
	const pad = INDENT.repeat(depth);
	if (node.nodeType !== Node.ELEMENT_NODE) {
		const text = inline(node).trim();
		if (text) out.push(pad + text);
		return;
	}
	const el = node as Element;
	const children = Array.from(el.childNodes).filter((c) => !isBlank(c));
	// Text mixed with elements is prose: its spacing means something, so
	// such an element stays on one line, as it was written.
	const prose = children.some(
		(c) =>
			c.nodeType === Node.TEXT_NODE || c.nodeType === Node.CDATA_SECTION_NODE,
	);
	if (!children.length || prose) {
		out.push(pad + inline(el));
		return;
	}
	out.push(pad + openTag(el));
	for (const child of children) write(child, depth + 1, out);
	out.push(`${pad}</${el.tagName}>`);
}

export function prettyXml(raw: string): string {
	if (typeof DOMParser === "undefined" || alreadyLaidOut(raw)) return raw;
	try {
		const doc = new DOMParser().parseFromString(raw, "application/xml");
		if (doc.getElementsByTagName("parsererror").length) return raw;
		const out: string[] = [];
		// The parser drops the declaration; it is part of the file.
		const declaration = /^\s*<\?xml[^>]*\?>/.exec(raw);
		if (declaration) out.push(declaration[0].trim());
		for (const node of Array.from(doc.childNodes)) write(node, 0, out);
		return out.join("\n");
	} catch {
		return raw;
	}
}
