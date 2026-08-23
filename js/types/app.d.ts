// Types for the globals this app builds at load time by looping or by `bind`.
//
// The admission rule for this file, and it is the whole reason the file is small:
//
//   a member may be declared here only if the code that creates it is a loop or a `bind`
//   whose result type is already known exactly.
//
// That is exactly the set of facts a reader can see and the checker cannot. `On.click`
// exists because `js/main.js` binds one static per name over a 42-entry array; `Html.new.div`
// exists because `js/globals.js` binds `document.createElement` over a 21-entry array. No
// annotation inside those files can express that, because the names are strings at runtime.
//
// What must NOT go in here:
//
//   - an index signature. `interface Graph { [k: string]: any }` removes ~174 errors and
//     makes `Graph.zooom` legal forever. Measured: with index signatures on Graph/App/
//     Settings/Window, two of four deliberately planted typos type-check. That is not a
//     migration, it is buying a lower error count with the thing the migration is for.
//   - an `any`-defaulted generic on a hot accessor. `byId<T = any>(id): T` removes 525
//     errors, every one of them by making the result untyped. See the note at the bottom.
//   - a member whose type you inferred from how it is used. Read the assignment or leave
//     it out; a wrong declaration is worse than no declaration, because it silences the
//     checker at the one place it was right.
//
// Measured effect of this file as written: 5,675 -> 4,943 errors under `tsc --checkJs`
// (-732), with all four planted typos still caught and zero collision diagnostics.

// ---------------------------------------------------------------------------
// `js/main.js`: On/Off get one static per event name, from two `forEach` loops over the
// same name array.
// ---------------------------------------------------------------------------
type EvBinder = (
    target: EventTarget,
    cb: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean
) => void;
// `touchmove`, `touchstart` and `wheel` are bound to `thisPassiveEvent`, which takes no
// options and hardcodes `{passive: true}`. Passing options to those three is a real
// mistake -- the argument is dropped and the listener is passive anyway -- so they get a
// narrower type rather than being folded in with the rest.
type PassiveEvBinder = (target: EventTarget, cb: EventListenerOrEventListenerObject) => void;

declare namespace On {
    var animationend: EvBinder; var blur: EvBinder; var change: EvBinder;
    var click: EvBinder; var contextmenu: EvBinder; var dblclick: EvBinder;
    var drag: EvBinder; var dragend: EvBinder; var dragenter: EvBinder;
    var dragleave: EvBinder; var dragover: EvBinder; var dragstart: EvBinder;
    var drop: EvBinder; var error: EvBinder; var focus: EvBinder;
    var gesturechange: EvBinder; var gestureend: EvBinder; var gesturestart: EvBinder;
    var input: EvBinder; var keydown: EvBinder; var keypress: EvBinder;
    var keyup: EvBinder; var load: EvBinder; var loadedmetadata: EvBinder;
    var message: EvBinder; var mousedown: EvBinder; var mouseenter: EvBinder;
    var mouseleave: EvBinder; var mousemove: EvBinder; var mouseout: EvBinder;
    var mouseover: EvBinder; var mouseup: EvBinder; var paste: EvBinder;
    var resize: EvBinder; var scroll: EvBinder; var touchcancel: EvBinder;
    var touchend: EvBinder; var transitionend: EvBinder;
    var visibilitychange: EvBinder;
    var touchmove: PassiveEvBinder; var touchstart: PassiveEvBinder;
    var wheel: PassiveEvBinder;
}
// `Off` binds every name through `removeEventListener`, which has no passive variant, so
// all 42 take the same shape.
declare namespace Off {
    var animationend: EvBinder; var blur: EvBinder; var change: EvBinder;
    var click: EvBinder; var contextmenu: EvBinder; var dblclick: EvBinder;
    var drag: EvBinder; var dragend: EvBinder; var dragenter: EvBinder;
    var dragleave: EvBinder; var dragover: EvBinder; var dragstart: EvBinder;
    var drop: EvBinder; var error: EvBinder; var focus: EvBinder;
    var gesturechange: EvBinder; var gestureend: EvBinder; var gesturestart: EvBinder;
    var input: EvBinder; var keydown: EvBinder; var keypress: EvBinder;
    var keyup: EvBinder; var load: EvBinder; var loadedmetadata: EvBinder;
    var message: EvBinder; var mousedown: EvBinder; var mouseenter: EvBinder;
    var mouseleave: EvBinder; var mousemove: EvBinder; var mouseout: EvBinder;
    var mouseover: EvBinder; var mouseup: EvBinder; var paste: EvBinder;
    var resize: EvBinder; var scroll: EvBinder; var touchcancel: EvBinder;
    var touchend: EvBinder; var touchmove: EvBinder; var touchstart: EvBinder;
    var transitionend: EvBinder; var visibilitychange: EvBinder; var wheel: EvBinder;
}

// ---------------------------------------------------------------------------
// `js/main.js`: Logger's four level methods do not appear in the class body at all.
// `#setFuncPerLevel` writes them from the `Logger.addLevel(...)` calls below the class,
// as `console[funcName].bind(console, prefix)`.
//
// `...a: any[]` here is not a suppression: it is `console.error`'s own signature.
// ---------------------------------------------------------------------------
interface LoggerShape {
    err(...a: any[]): void;
    warn(...a: any[]): void;
    info(...a: any[]): void;
    debug(...a: any[]): void;
    level: number;
    levelId: string;
    on(): number;
    off(): number;
    addLevel(prefix: string, funcName: 'error' | 'warn' | 'info' | 'log', id?: string): LoggerShape;
}
declare var Logger: LoggerShape;

// ---------------------------------------------------------------------------
// `js/globals.js:387`: `Html.new.<tag>` is `document.createElement.bind(Elem, tag)` over a
// 21-name array, and eight of `Html.make.<tag>` are `makeWithClass.bind(Elem, tag)` over
// an 8-name array.
//
// Mapping through `HTMLElementTagNameMap` rather than returning `HTMLElement` is what
// keeps this a type and not a suppression: `Html.new.div().value` stays an error, and
// `Html.new.input().value` is allowed.
// ---------------------------------------------------------------------------
type HtmlNewTag = 'a' | 'audio' | 'button' | 'code' | 'canvas'
    | 'div' | 'iframe' | 'img' | 'input' | 'label' | 'li'
    | 'p' | 'pre' | 'select' | 'script' | 'span'
    | 'table' | 'td' | 'textarea' | 'tr' | 'video';
type HtmlMakeTag = 'code' | 'div' | 'iframe' | 'input'
    | 'pre' | 'select' | 'span' | 'textarea';

declare var Html: {
    create<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
    new: { [K in HtmlNewTag]: () => HTMLElementTagNameMap[K] };
    // The loop-bound eight take only a class name. `a`, `button` and `li` are written by
    // hand in the object literal and take their own arguments.
    make: { [K in HtmlMakeTag]: (className?: string) => HTMLElementTagNameMap[K] } & {
        a(href?: string, className?: string): HTMLAnchorElement;
        button(className?: string, textContent?: string): HTMLButtonElement;
        li(content?: string | Node, className?: string, onClick?: (e: MouseEvent) => void): HTMLLIElement;
    };
    makeWithClass<K extends keyof HTMLElementTagNameMap>(tagName: K, className?: string): HTMLElementTagNameMap[K];
};

// ---------------------------------------------------------------------------
// Deliberately absent: `Elem.byId`.
//
// `js/main.js` writes `static byId = document.getElementById.bind(document)` inside
// `class Elem`, and TypeScript already infers `(id: string) => HTMLElement | null` from
// that. Declaring it here is not neutral, it is worse: `class Elem` already owns the
// static, so a `declare namespace Elem { function byId() }` collides (TS2687/TS2717) and
// the tree gets one error *worse*.
//
// Declaring it as `byId<T = any>(id: string): T` instead removes 525 errors. Every one of
// those 525 disappears because the result stopped having a type -- it is the single
// largest suppression available in this codebase, and it is why the number is recorded
// here rather than taken.
//
// The ~335 "possibly null" errors that `byId` leaves behind are the migration's findings.
// Fix them at the call site with a null check, or with `Elem.byId('x')!` where the element
// is in `index.html` and the code runs after load.
// ---------------------------------------------------------------------------
