// Minimal DOM double built from the markup in contracts/ui/city-search.md section 2.
// It implements only generic DOM behaviour. It knows nothing about the implementation.
export class Text {
  constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

export class Env {
  constructor() { this.created = []; this.violations = []; }
}

export class El {
  constructor(env, tag, attrs = {}) {
    this.env = env; this.nodeType = 1; this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs }; this.childNodes = []; this.parentNode = null;
    this.listeners = {}; this.value = ""; this.style = {}; this.disabled = false;
    this.ownerDocument = null; this.focused = false;
  }
  get hidden() { return this.attrs.hidden !== undefined; }
  set hidden(v) { if (v) this.attrs.hidden = ""; else delete this.attrs.hidden; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get id() { return this.attrs.id ?? ""; }
  get type() { return this.attrs.type ?? (this.tagName === "BUTTON" ? "submit" : ""); }
  set type(v) { this.attrs.type = v; }
  get rel() { return this.attrs.rel ?? ""; }
  set rel(v) { this.attrs.rel = v; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.childNodes.forEach((c) => (c.parentNode = null)); this.childNodes = []; if (String(v) !== "") this.appendChild(new Text(v)); }
  set innerHTML(v) { this.env.violations.push("innerHTML"); throw new Error("innerHTML is banned"); }
  get innerHTML() { return ""; }
  set outerHTML(v) { this.env.violations.push("outerHTML"); throw new Error("outerHTML is banned"); }
  insertAdjacentHTML() { this.env.violations.push("insertAdjacentHTML"); throw new Error("banned"); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { ns.forEach((n) => this.appendChild(typeof n === "string" ? new Text(n) : n)); }
  removeChild(n) { this.childNodes = this.childNodes.filter((c) => c !== n); n.parentNode = null; return n; }
  replaceChildren(...ns) { this.textContent = ""; this.append(...ns); }
  remove() { this.parentNode?.removeChild(this); }
  focus() { this.focused = true; }
  blur() { this.focused = false; }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== f); }
  dispatchEvent(ev) {
    ev.target ??= this;
    for (let n = this; n; n = n.parentNode) {
      ev.currentTarget = n;
      for (const f of [...(n.listeners[ev.type] ?? [])]) f.call(n, ev);
      if (ev.cancelBubble) break;
    }
    return !ev.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    const ev = mkEvent("click");
    this.dispatchEvent(ev);
    if (!ev.defaultPrevented && this.tagName === "BUTTON" && this.type === "submit") {
      const form = this.closest("form");
      if (form) form.dispatchEvent(mkEvent("submit"));
    }
  }
  closest(tag) { for (let n = this; n; n = n.parentNode) if (n.tagName === tag.toUpperCase()) return n; return null; }
  matches(sel) {
    let m;
    if ((m = sel.match(/^\[data-testid="([^"]+)"\]$/))) return this.attrs["data-testid"] === m[1];
    if ((m = sel.match(/^#(.+)$/))) return this.attrs.id === m[1];
    if ((m = sel.match(/^\[([a-z-]+)\]$/))) return m[1] in this.attrs;
    return this.tagName === sel.toUpperCase();
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  getElementById(id) { return this.querySelector("#" + id); }
  get isVisible() {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.hidden || n.style.display === "none") return false;
    return true;
  }
}

export function mkEvent(type, extra = {}) {
  return { type, defaultPrevented: false, cancelBubble: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }, ...extra };
}

// Builds the section from contract section 2 and installs a trapping `document`.
export function buildPage() {
  const env = new Env();
  const mk = (tag, attrs = {}, kids = []) => {
    const e = new El(env, tag, attrs); e.ownerDocument = doc; env.created.push(e);
    kids.forEach((k) => e.appendChild(typeof k === "string" ? new Text(k) : k));
    return e;
  };
  const doc = {
    createElement: (t) => mk(t),
    createTextNode: (t) => new Text(t),
    createDocumentFragment: () => mk("fragment"),
    getElementById: (id) => root.querySelector("#" + id),
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
    write() { env.violations.push("document.write"); throw new Error("banned"); },
    get cookie() { return ""; },
    set cookie(v) { env.violations.push("cookie"); },
  };
  const link = (href, text) => mk("a", { href, rel: "noopener noreferrer", target: "_blank" }, [text]);
  const input = mk("input", { id: "city-search-input", "data-testid": "city-search-input", type: "search", maxlength: "100", autocomplete: "off" });
  const button = mk("button", { type: "submit", "data-testid": "city-search-submit" }, ["Search"]);
  const form = mk("form", { "data-testid": "city-search-form", role: "search" }, [mk("label", { for: "city-search-input" }, ["City name"]), input, button]);
  const status = mk("p", { "data-testid": "city-search-status", role: "status" });
  const list = mk("ul", { "data-testid": "city-search-results", "aria-label": "Matching places", hidden: "" });
  const attribution = mk("p", { "data-testid": "city-search-attribution" }, ["Place search by ", link("https://open-meteo.com/", "Open-Meteo.com"), ", data from ", link("https://www.geonames.org/", "GeoNames")]);
  const root = mk("section", { "data-testid": "city-search", hidden: "" }, [mk("h2", { id: "city-search-heading" }, ["Search for a city"]), form, status, list, attribution]);
  env.created.length = 0; // only elements created by the implementation are tracked
  return { env, doc, root, input, button, form, status, list, attribution };
}
