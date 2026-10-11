// Settings as a modal (#82), the way Notion's settings work: the menu's Settings row opens a
// large dialog over the page, its pages listed in a sidebar, the chosen one shown beside it.
// Notes and Ai are two of those pages -- the panels' markup whole, in `#tab1` and `#tab4` --
// and the rest are the sections of the Settings markup (`#tab5`) that name a page with
// `data-page`. Every control keeps the id and the wiring it had as a panel of the menu.
//
// Closed by Esc, a click outside the dialog, or its close button, and focus goes back to what
// opened it. While it is open everything behind it is inert, so Tab stays in the dialog and a
// click cannot reach the Graph -- except `#customModal`, which its own controls open. The
// canvas's keys stay out of it too (`Hud.isTyping`, the digit shortcuts). The page last shown
// is the one it opens on, unless an update is ready, when it opens on Updates.
const SettingsModal = {
    root: Elem.byId('settingsModal'),
    body: Elem.byId('settingsBody'),
    title: Elem.byId('settingsPageTitle'),
    nav: document.querySelector('#settingsModal .settings-nav'),
    // Which container each page is; every other page is sections of `#tab5`.
    tabs: {notes: 'tab1', ai: 'tab4'},
    key: 'settings-page',
    opener: null,
    inerted: [],

    isOpen(){ return !SettingsModal.root.hidden },
    items(){ return [...SettingsModal.nav.querySelectorAll('.settings-nav-item')].filter( (item)=>!item.hidden ) },

    open(page){
        if (SettingsModal.isOpen()) return SettingsModal.show(page ?? SettingsModal.page);

        SettingsModal.opener = document.activeElement;
        // The menu's own Escape and focus rules are for the menu; it closes as the dialog opens.
        if (dropdownContent.classList.contains('open')) menuButton.click();
        SettingsModal.root.hidden = false;
        SettingsModal.setPageInert(true);
        const ready = Elem.byId('settingsNavUpdates').classList.contains('update-ready');
        SettingsModal.show(page ?? (ready ? 'updates' : SettingsModal.remembered()));
        SettingsModal.nav.querySelector('[aria-current="page"]')?.focus();
    },

    close(){
        if (!SettingsModal.isOpen()) return;

        SettingsModal.root.hidden = true;
        SettingsModal.setPageInert(false);
        // The menu was closed as the dialog opened, so a row of it cannot take the focus back;
        // the menu button stands for it.
        const back = SettingsModal.opener;
        const target = (back?.isConnected && back !== document.body && !dropdownContent.contains(back)) ? back : menuButton;
        target.focus?.();
        SettingsModal.opener = null;
    },

    // Everything beside the dialog's own line of ancestors, and only what was not inert
    // already, so the closed menu, which keeps itself inert, is left as it was.
    setPageInert(on){
        if (!on) {
            for (const el of SettingsModal.inerted) el.inert = false;
            SettingsModal.inerted = [];
            return;
        }
        for (let el = SettingsModal.root; el !== document.body; el = el.parentElement) {
            for (const sibling of el.parentElement.children) {
                if (sibling === el || sibling.inert || sibling.contains(Modal.div)) continue;

                sibling.inert = true;
                SettingsModal.inerted.push(sibling);
            }
        }
    },

    remembered(){
        const page = localStorage.getItem(SettingsModal.key);
        return SettingsModal.items().some( (item)=>(item.dataset.page === page) ) ? page : 'notes';
    },

    show(page){
        const item = SettingsModal.items().find( (item)=>(item.dataset.page === page) ) ?? SettingsModal.items()[0];
        page = item.dataset.page;
        SettingsModal.page = page;
        localStorage.setItem(SettingsModal.key, page);

        // One Tab stop for the sidebar, the chosen page's, and the arrows between them, so
        // Tab goes from the sidebar to the page rather than through seven rows first.
        for (const other of SettingsModal.items()) {
            if (other === item) other.setAttribute('aria-current', 'page');
            else other.removeAttribute('aria-current');
            other.tabIndex = (other === item) ? 0 : -1;
        }
        SettingsModal.title.textContent = item.textContent.trim();

        const tab = SettingsModal.tabs[page] ?? 'tab5';
        for (const id of ['tab1', 'tab4', 'tab5']) Elem.byId(id).style.display = (id === tab) ? 'block' : 'none';
        // Settings' own sections, one page's at a time. A page of one section is named by the
        // title above it, so the section's own heading would say it twice (`.solo`).
        const sections = [...Elem.byId('tab5').querySelectorAll('.settings-section[data-page]')];
        for (const section of sections) section.classList.toggle('page-hidden', section.dataset.page !== page);
        SettingsModal.body.classList.toggle('solo', sections.filter( (s)=>(s.dataset.page === page) ).length === 1);
        SettingsModal.body.scrollTop = 0;

        // What measures itself measures again now it is shown: the sliders' fills and values,
        // and the notes editor, which lays its text out to the width it last had.
        refreshSliders(Elem.byId(tab));
        if (page === 'notes') window.currentActiveZettelkastenMirror?.refresh();
    },

    // The arrows move through the sidebar and choose as they go, as Notion's sidebar does: up
    // and down, and left and right where the sidebar is a strip across the top.
    onNavKey(e){
        const step = {ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1}[e.key];
        if (!step) return;

        const items = SettingsModal.items();
        const at = items.indexOf(document.activeElement);
        if (at < 0) return;

        e.preventDefault();
        const next = items[(at + step + items.length) % items.length];
        next.focus();
        SettingsModal.show(next.dataset.page);
    },

    // Esc closes it -- unless one of the windows its controls open is on top, which takes Esc
    // first (`custommodal.js`), or something inside already answered the key, as an open
    // select list does.
    onKey(e){
        if (e.key !== 'Escape' || !SettingsModal.isOpen()) return;
        if (Modal.current || e.defaultPrevented) return;

        e.preventDefault();
        SettingsModal.close();
    },

    init(){
        On.click(Elem.byId('settings-button'), ()=>SettingsModal.open() );
        On.click(Elem.byId('settingsClose'), SettingsModal.close);
        On.click(Elem.byId('settingsBackdrop'), SettingsModal.close);
        for (const item of SettingsModal.nav.querySelectorAll('.settings-nav-item')) {
            On.click(item, ()=>SettingsModal.show(item.dataset.page) );
        }
        On.keydown(SettingsModal.nav, SettingsModal.onNavKey);
        On.keydown(document, SettingsModal.onKey);
    }
}

SettingsModal.init();
