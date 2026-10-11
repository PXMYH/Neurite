// A still of a shared screen, window or tab: the menu's Share screen row drops one on the
// canvas (`neuralapi.js` binds it), and the Neural API's vision loop reads one each step
// (`Recorder.returnScreenshot`). Recording a video of it was the other half of this object
// until #78 took the Record row out of the menu, and nothing else started a recording.
const Recorder = {
    async captureScreenToBase64(){
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const video = Html.new.video();
        video.srcObject = stream;
        video.autoplay = true;
        video.style.display = 'none';

        return new Promise((resolve, reject) => {
            On.loadedmetadata(video, (e)=>{
                const canvas = Html.new.canvas();
                const context = canvas.getContext('2d');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

                this.endStream(stream);

                resolve(canvas.toDataURL('image/png', 1.0));
            });

            video.onerror = (err) => {
                Logger.err("In capturing video:", err);
                reject(err);
            };
        });
    },

    async captureScreenToImage(){
        try {
            const base64Image = await this.captureScreenToBase64();

            const img = new Image();
            img.src = base64Image;
            img.style.width = '800px';
            img.style.height = 'auto';

            img.onload = function () {
                const node = NodeView.addForImage(img, "Screenshot");
                Graph.appendNode(node);
                node.followingMouse = 1;
                node.draw();
                node.mouseAnchor = toDZ(new vec2(0, -node.content.offsetHeight / 2 + 6));
            };
        } catch (err) {
            Logger.err(err)
        }
    },

    endStream(stream){
        // Stop all tracks in the stream to end it
        stream.getTracks().forEach( (track)=>track.stop() )
    }
}
