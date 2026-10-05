// A small well-formedness check for the inline SVGs (the repository has no XML parser and the tests load no new package): one root element,
// every element closed in order, attributes quoted with no "<" and only known entities, and text with no bare "<" or "&". Returns null when
// the text is well formed, or the first problem found.
const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
const badAmp = (s) => /&/.test(s.replace(ENTITY, ""));

export function xmlProblem(text) {
  let s = String(text).replace(/^\s*<\?xml[^?]*\?>\s*/, "");
  const stack = [];
  let roots = 0, i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    const chunk = lt < 0 ? s.slice(i) : s.slice(i, lt);
    if (badAmp(chunk)) return `bare & in text near "${chunk.slice(0, 40)}"`;
    if (chunk.trim() && !stack.length) return `text outside the root: "${chunk.trim().slice(0, 40)}"`;
    if (lt < 0) break;
    if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt); if (e < 0) return "unclosed comment"; i = e + 3; continue; }
    const gt = s.indexOf(">", lt);
    if (gt < 0) return "unclosed tag";
    const tag = s.slice(lt + 1, gt);
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      if (stack.pop() !== name) return `closing </${name}> does not match`;
    } else {
      const self = tag.endsWith("/");
      const m = /^([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*="[^"]*")*)\s*\/?$/.exec(tag);
      if (!m) return `malformed tag <${tag.slice(0, 60)}>`;
      for (const a of m[2].matchAll(/([\w:.-]+)="([^"]*)"/g)) {
        if (a[2].includes("<")) return `< in attribute ${a[1]}`;
        if (badAmp(a[2])) return `bare & in attribute ${a[1]}`;
      }
      const names = [...m[2].matchAll(/([\w:.-]+)=/g)].map((x) => x[1]);
      if (new Set(names).size !== names.length) return `repeated attribute in <${m[1]}>`;
      if (!stack.length) { roots++; if (roots > 1) return "more than one root element"; }
      if (!self) stack.push(m[1]);
    }
    i = gt + 1;
  }
  if (stack.length) return `unclosed <${stack[stack.length - 1]}>`;
  if (roots !== 1) return "no root element";
  return null;
}
