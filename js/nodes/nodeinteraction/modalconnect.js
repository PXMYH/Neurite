Modal.Connect = class {
    maxNodes = 8;
    constructor(originNode){
        this.originNode = originNode;

        Modal.open('nodeConnectionModal'); // clones searchBar and nodeList
        this.searchBar = Elem.byId('connectModalSearchBar');
        this.nodeList = Elem.byId('nodeList');

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
        this.nodeList.appendChild(li);
    }
    // Enter takes the first Node listed, so the list can be used without a pointer.
    onKeyDown = (e)=>{
        if (e.key !== 'Enter') return;

        e.preventDefault();
        this.nodeList.querySelector('li[data-node-id]')?.click();
    }
    onItemClicked = (e)=>{
        const li = e.target;
        const node = Node.byUuid(li.dataset.nodeId);
        const originNode = this.originNode;
        const existingEdge = findExistingEdge(node, originNode);
        if (!existingEdge) {
            connectNodes(node, originNode);
            li.setAttribute('class', 'connected');
            return;
        }

        // The one removal rule, Refs and all (`Edge.removeInstance`).
        existingEdge.removeInstance();
        li.setAttribute('class', 'disconnected');
    }
}
