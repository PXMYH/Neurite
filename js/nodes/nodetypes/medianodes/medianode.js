function createMediaNode(type, metadataOrFile, url) {
    const elem = Html.new[type](); // audio or video
    elem.style.display = "block";
    elem.setAttribute("controls", "");
    elem.src = url;

    if (type !== 'audio') {
        On.loadedmetadata(elem, () => {
            const maxHeight = 600;
            if (elem.videoHeight <= maxHeight) return;

            const aspectRatio = elem.videoWidth / elem.videoHeight;
            elem.style.height = maxHeight + 'px';
            elem.style.width = (maxHeight * aspectRatio) + 'px';
        });
    }

    const name = (typeof metadataOrFile === 'string' ? metadataOrFile : metadataOrFile.name || 'Untitled Media');
    const node = new Node();
    NodeView.addAtNaturalScale(node, name, [elem]);
    // A dropped file's sound or video lives only in this page's memory: marked, as an image
    // is (imagenode.js), the save keeps it with the Graph and a file carries it. Unmarked, it
    // was in neither, and came back from a reload or a file as a player with nothing to play.
    if (url?.startsWith('blob:')) node.blob = name;
    return node;
}

