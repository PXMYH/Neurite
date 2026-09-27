Modal.Connect = class {
    maxNodes = 8;
    constructor(originNode){
        this.originNode = originNode;

        Modal.open('nodeConnectionModal'); // clones searchBar and nodeList
        // Which note is being linked from, which the title did not say.
        const title = originNode.getTitle().trim();
        Modal.div.querySelector('.modal-title').textContent = (title ? `Link "${title}" to…` : 'Link to…');
        this.searchBar = Elem.byId('connectModalSearchBar');
        this.nodeList = Elem.byId('nodeList');
        this.nodeList.setAttribute('role', 'listbox');
        this.nodeList.setAttribute('aria-label', 'Nodes to link to');

        this.updateNodeList();
        On.input(this.searchBar, this.updateNodeList);
        On.keydown(this.searchBar, this.onKeyDown);
        this.searchBar.focus();
    }

    setContents(html){ this.nodeList.innerHTML = html }
    // With nothing typed, the Nodes nearest this one on the Plane (#50). It opened with the
    // Node's own Title as the query and leaves the Node itself out of the list, so the list
    // was empty unless another Node shared a word of that Title.
    updateNodeList = ()=>{
        const searchTerm = this.searchBar.value.trim();
        const nodes = (searchTerm) ? nodesForSearchTerm(searchTerm, this.maxNodes + 1)
                    : this.nearestNodes();
        const others = nodes.filter(Object.isntThis, this.originNode).slice(0, this.maxNodes);
        this.setContents(others.length > 0 ? '' : '<li>No notes found.</li>');
        others.forEach(this.addItem, this);
        this.setActive(null);
    }
    nearestNodes(){
        const origin = this.originNode.pos;
        const nodes = [];
        Graph.forEachNode( (node)=>{
            clearSearchHighlight(node);
            nodes.push(node);
        });
        const distance = (node)=>node.pos.minus(origin).mag();
        return nodes.sort( (a, b)=>(distance(a) - distance(b)) );
    }
    addItem(node){
        const textContent = node.getTitle().trim() || 'Untitled';
        const className = (findExistingEdge(node, this.originNode))
                        ? 'connected' : 'disconnected';
        const li = Html.make.li(textContent, className, this.onItemClicked);
        li.dataset.nodeId = node.uuid;
        li.id = 'connect-option-' + node.uuid;
        li.setAttribute('role', 'option');
        this.nodeList.appendChild(li);
    }

    rows(){ return [...this.nodeList.querySelectorAll('li[data-node-id]')] }
    // The row the arrows are on, read out through the field that keeps the caret.
    setActive(li){
        this.active?.classList.remove('active');
        this.active?.setAttribute('aria-selected', 'false');
        this.active = li;
        if (li) {
            li.classList.add('active');
            li.setAttribute('aria-selected', 'true');
            li.scrollIntoView({block: 'nearest'});
            this.searchBar.setAttribute('aria-activedescendant', li.id);
        } else {
            this.searchBar.removeAttribute('aria-activedescendant');
        }
    }
    // The arrows move through the list, and Enter takes the row they are on. With no row
    // chosen, Enter links the first Node not linked yet: it took the first row, and the
    // nearest Node is often one already linked, so Enter unlinked it and took the Ref out of
    // the note's sentence.
    onKeyDown = (e)=>{
        const rows = this.rows();
        const at = rows.indexOf(this.active);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!rows.length) return;
            const down = (e.key === 'ArrowDown');
            const next = (at < 0) ? (down ? 0 : rows.length - 1)
                       : (at + (down ? 1 : -1) + rows.length) % rows.length;
            this.setActive(rows[next]);
            return;
        }
        if (e.key !== 'Enter') return;

        e.preventDefault();
        (this.active ?? rows.find( (li)=>li.classList.contains('disconnected') ))?.click();
    }
    onItemClicked = (e)=>{
        const li = e.target;
        const node = Node.byUuid(li.dataset.nodeId);
        const originNode = this.originNode;
        const existingEdge = findExistingEdge(node, originNode);
        if (!existingEdge) {
            connectNodes(node, originNode);
            li.setAttribute('class', 'connected' + (li === this.active ? ' active' : ''));
            return;
        }

        // The one removal rule, Refs and all (`Edge.removeInstance`).
        existingEdge.removeInstance();
        li.setAttribute('class', 'disconnected' + (li === this.active ? ' active' : ''));
    }
}
