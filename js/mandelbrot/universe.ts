// The universe under the Fractal: a sky of stars, a galaxy seen almost edge on with the glow of its
// brightest stars along the disc, and the haze of a nebula, on one WebGL canvas, `#universe`
// (viewmatrix.html), painted before `#svg_bg`. The Fractal stays the coordinate system; this is
// only what is behind it, so it takes no input (`pointer-events: none`) and nothing of it is saved.
//
// It is drawn from `NodeSimulation.nodeStep`, after `Svg.updateViewbox`, so it moves in the same
// frame as the view and keeps the `framesDelay` throttle. The sky follows the view three ways:
//   - a pan: the screen distance the Plane moved, added up frame by frame -- never the pan itself,
//     which deep in a zoom is a number too large to move stars by. Near stars move more than far
//     ones, the galaxy hardly at all;
//   - a zoom: the stars come towards the reader zooming in, and go away out, one octave of zoom a
//     few depths of the field, each star fading in far and out near so none of them pops;
//   - a turn: the whole sky turns with the Plane.
// The disc turns, its middle faster than its edge, and the brightest stars twinkle. Under
// `prefers-reduced-motion` none of that moves: no time, and no parallax.
//
// It costs a GPU a few points of fill rate a frame, and a computer drawing WebGL in software far
// more, so it starts at one canvas pixel to a CSS pixel and takes the device's own resolution only
// after two seconds of fast frames; slow frames step it down again, to three quarters of a CSS
// pixel at the least. While the view is still it draws every second frame. Without WebGL, or with
// the switch in the Fractal panel off, the canvas is hidden and the page is the colour it was.

type Pts = { pos: WebGLBuffer, col: WebGLBuffer, siz: WebGLBuffer, n: number };

const Universe = {
    canvas: null as HTMLCanvasElement | null,
    gl: null as WebGLRenderingContext | null,
    points: null as WebGLProgram | null,
    backdrop: null as WebGLProgram | null,
    quad: null as WebGLBuffer | null,
    nebula: null as WebGLTexture | null,
    sets: {} as Record<string, Pts>,
    enabled: true,
    lost: false,

    // Where the sky is: the screen distance the Plane has moved, its zoom in octaves, its turn.
    panX: 0, panY: 0, travel: 0, angle: 0,
    lastPan: null as {x: number, y: number} | null,
    lastMag: 0,
    moved: true,
    still: 0,
    frame: 0,
    clock: 0,
    lastTime: 0,

    // Canvas pixels to a CSS pixel, the most it may take again, and the frames it was measured over.
    quality: 1,
    ceiling: 2,
    fastSince: 0,
    slowFrames: 0,
    drawnFrames: 0,

    GALAXY: {x: 0.58, y: 0.6, r: 1.35, tilt: 0.3, roll: -0.16},
    COUNTS: {stars: 4500, galaxy: 26000, orbs: 420},

    init(){
        const canvas = document.getElementById('universe') as HTMLCanvasElement | null;
        if (!canvas) return;

        this.canvas = canvas;
        this.enabled = (localStorage.getItem('universe') !== 'off');
        const toggle = document.getElementById('universe-checkbox') as HTMLInputElement | null;
        if (toggle) {
            toggle.checked = this.enabled;
            On.change(toggle, ()=>this.setEnabled(toggle.checked));
        }
        // A lost context -- the GPU reset, or the system took it back -- shows the page's own colour
        // until the browser gives it back; then everything is built again.
        On.webglcontextlost(canvas, (e: Event)=>{ e.preventDefault(); this.lost = true; this.show(); });
        On.webglcontextrestored(canvas, ()=>{ this.lost = false; this.build(); });
        this.build();
    },
    setEnabled(on: boolean){
        this.enabled = on;
        localStorage.setItem('universe', on ? 'on' : 'off');
        this.show();
        this.moved = true;
    },
    show(){
        if (!this.canvas) return;
        const showing = this.enabled && Boolean(this.gl) && !this.lost;
        this.canvas.hidden = !showing;
        document.body.classList.toggle('universe', showing);
    },

    build(){
        const canvas = this.canvas!;
        const gl = canvas.getContext('webgl', {alpha: false, antialias: false, depth: false,
                                               preserveDrawingBuffer: false, powerPreference: 'low-power'});
        this.gl = gl;
        if (!gl) {
            Logger.warn("No WebGL here: the universe stays dark.");
            return this.show();
        }
        try {
            this.points = this.program(gl, Universe.SHADERS.pointsVs, Universe.SHADERS.pointsFs);
            this.backdrop = this.program(gl, Universe.SHADERS.backdropVs, Universe.SHADERS.backdropFs);
        } catch (err) {
            Logger.warn("The universe's shaders did not build:", err);
            this.gl = null;
            return this.show();
        }
        this.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        this.nebula = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.nebula);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.paintNebula(1024));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const sky = Universe.Sky.make(1979);
        this.sets = {
            stars: this.upload(gl, sky.stars(this.COUNTS.stars)),
            galaxy: this.upload(gl, sky.galaxy(this.COUNTS.galaxy)),
            orbs: this.upload(gl, sky.orbs(this.COUNTS.orbs)),
        };
        this.moved = true;
        this.show();
    },

    program(gl: WebGLRenderingContext, vs: string, fs: string){
        const shader = (type: number, src: string)=>{
            const sh = gl.createShader(type)!;
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
            return sh;
        };
        const p = gl.createProgram()!;
        gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, shader(gl.FRAGMENT_SHADER, Universe.SHADERS.precision + fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
        return p;
    },
    upload(gl: WebGLRenderingContext, data: {pos: Float32Array, col: Float32Array, siz: Float32Array}): Pts {
        const buffer = (arr: Float32Array)=>{
            const b = gl.createBuffer()!;
            gl.bindBuffer(gl.ARRAY_BUFFER, b);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
            return b;
        };
        return {pos: buffer(data.pos), col: buffer(data.col), siz: buffer(data.siz), n: data.pos.length / 3};
    },

    // The nebula, painted once on a 2D canvas: soft clouds of colour on near black, densest along
    // the disc, where the video's green haze and magenta glow are.
    paintNebula(size: number){
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const x = c.getContext('2d')!;
        x.fillStyle = '#010106';
        x.fillRect(0, 0, size, size);
        x.globalCompositeOperation = 'lighter';
        const r = Universe.Sky.make(7);
        const clouds: [number, number, number, number[], number][] = [
            [0.66, 0.56, 0.26, [255, 50, 170], 0.05],
            [0.72, 0.52, 0.22, [30, 230, 170], 0.06],
            [0.25, 0.30, 0.30, [100, 70, 255], 0.03],
            [0.45, 0.70, 0.25, [255, 80, 140], 0.035],
            [0.80, 0.30, 0.20, [40, 140, 255], 0.04],
        ];
        for (const [cx, cy, radius, rgb, a] of clouds) {
            for (let i = 0; i < 40; i++) {
                const px = (cx + r.gauss() * radius * 0.4) * size, py = (cy + r.gauss() * radius * 0.22) * size;
                const pr = (0.2 + r.rand() * 0.4) * radius * size;
                const g = x.createRadialGradient(px, py, 0, px, py, pr);
                g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a * (0.3 + r.rand() * 0.7)})`);
                g.addColorStop(0.6, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a * 0.25})`);
                g.addColorStop(1, 'rgba(0,0,0,0)');
                x.fillStyle = g;
                x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
            }
        }
        return c;
    },

    // Called every frame the Graph is drawn.
    draw(time: number){
        const gl = this.gl;
        if (!this.enabled || !gl || this.lost || !this.canvas) return;

        const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.follow(still);
        const dt = (this.lastTime ? Math.min(100, time - this.lastTime) : 16);
        this.lastTime = time;
        this.measure(dt);

        // Every second frame while nothing moves, and none at all when nothing can.
        if (!still) this.clock += dt / 1000;
        this.frame += 1;
        const resized = this.resize();
        if (!this.moved && !resized && (still || this.frame % 2)) return;
        this.moved = false;

        const w = innerWidth, h = innerHeight, G = this.GALAXY;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        gl.disable(gl.BLEND);
        gl.useProgram(this.backdrop);
        this.attrib(this.backdrop!, 'aXY', this.quad!, 2);
        const ub = (n: string)=>gl.getUniformLocation(this.backdrop!, n);
        gl.uniform2f(ub('uViewport'), w, h);
        gl.uniform2f(ub('uShift'), -this.panX * 0.00001, this.panY * 0.00001);
        gl.uniform1f(ub('uAngle'), this.angle);
        // The core where the points put it: the galaxy's middle, turned with the view, then moved.
        const cx = (G.x - 0.5) * w, cy = (G.y - 0.5) * h, c = Math.cos(this.angle), s = Math.sin(this.angle);
        gl.uniform3f(ub('uCore'), c * cx - s * cy + this.panX * 0.012, s * cx + c * cy + this.panY * 0.012, G.r * Math.min(w, h));
        gl.uniform1f(ub('uTilt'), G.tilt);
        gl.uniform1f(ub('uRoll'), G.roll);
        gl.bindTexture(gl.TEXTURE_2D, this.nebula);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.useProgram(this.points);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        const up = (n: string)=>gl.getUniformLocation(this.points!, n);
        gl.uniform1f(up('uTime'), this.clock);
        gl.uniform2f(up('uViewport'), w, h);
        gl.uniform1f(up('uDpr'), this.canvas.width / w);
        gl.uniform2f(up('uPan'), this.panX, this.panY);
        gl.uniform1f(up('uTravel'), this.travel);
        gl.uniform1f(up('uAngle'), this.angle);
        gl.uniform3f(up('uGalaxy'), G.x, G.y, G.r);
        gl.uniform1f(up('uTilt'), G.tilt);
        gl.uniform1f(up('uRoll'), G.roll);
        for (const [name, kind] of [['stars', 0], ['galaxy', 1], ['orbs', 2]] as [string, number][]) {
            const set = this.sets[name];
            gl.uniform1f(up('uKind'), kind);
            this.attrib(this.points!, 'aPos', set.pos, 3);
            this.attrib(this.points!, 'aColor', set.col, 4);
            this.attrib(this.points!, 'aSize', set.siz, 3);
            gl.drawArrays(gl.POINTS, 0, set.n);
        }
    },
    attrib(program: WebGLProgram, name: string, buffer: WebGLBuffer, size: number){
        const gl = this.gl!;
        const loc = gl.getAttribLocation(program, name);
        if (loc < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    },

    // The view, as the sky needs it. `Graph.pan` and `Graph.zoom` are new objects every frame,
    // still or not (`Autopilot.update`), so it is their numbers that are compared.
    follow(still: boolean){
        const graph = Graph as any;
        const pan = graph.pan, zoom = graph.zoom;
        const mag = Math.hypot(zoom.x, zoom.y);
        if (!(mag > 0)) return;

        const angle = -Math.atan2(zoom.y, zoom.x);
        if (this.lastPan && !still) {
            // Where the Plane under the view went on screen: the pan's step over the zoom, a
            // complex division, so a turned view moves the sky the way the Plane moved.
            const dx = this.lastPan.x - pan.x, dy = this.lastPan.y - pan.y;
            const k = Math.min(innerWidth, innerHeight) / 2 / (mag * mag);
            const sx = (dx * zoom.x + dy * zoom.y) * k, sy = (dy * zoom.x - dx * zoom.y) * k;
            // A jump -- Home, a Saved View, another graph -- is no flight through the stars.
            if (Math.hypot(sx, sy) < Math.max(innerWidth, innerHeight)) {
                this.panX += sx;
                this.panY += sy;
            }
            if (this.lastMag) this.travel += Math.log2(this.lastMag / mag) * 0.18;
        }
        if (!this.lastPan || pan.x !== this.lastPan.x || pan.y !== this.lastPan.y
            || mag !== this.lastMag || angle !== this.angle) this.moved = true;
        this.lastPan = {x: pan.x, y: pan.y};
        this.lastMag = mag;
        this.angle = angle;
    },

    // Slow frames step the canvas down; two seconds of fast ones step it up to the device's own.
    measure(dt: number){
        // `framesDelay` draws the Graph every few frames on purpose; that is no slow frame.
        const every = Math.round((settings.framesDelay + 2) ** 2 / 4);
        this.drawnFrames += 1;
        if (dt > 21 * every) this.slowFrames += 1;
        if (this.drawnFrames < 45) return;

        const slow = (this.slowFrames > 22);
        this.drawnFrames = this.slowFrames = 0;
        // A resolution found slow is never taken again: stepping back up to it each time two
        // seconds went well swung the frame rate between the two for as long as the page was open.
        const best = Math.min(devicePixelRatio || 1, this.ceiling);
        if (slow) {
            this.fastSince = 0;
            this.ceiling = Math.max(0.75, this.quality - 0.25);
            this.quality = Math.max(0.75, this.quality - 0.25);
        } else if (this.quality < best) {
            this.fastSince ||= performance.now();
            if (performance.now() - this.fastSince > 2000) this.quality = best;
        }
    },
    resize(){
        const canvas = this.canvas!;
        const w = Math.max(1, Math.round(innerWidth * this.quality));
        const h = Math.max(1, Math.round(innerHeight * this.quality));
        if (canvas.width === w && canvas.height === h) return false;

        canvas.width = w;
        canvas.height = h;
        return true;
    },

    // The sky's points, from a seeded generator, so a reload draws the same universe.
    Sky: {
        make(seed: number){
            let s = seed >>> 0;
            const rand = ()=>((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
            const gauss = ()=>{
                let u = 0, v = 0;
                while (u === 0) u = rand();
                while (v === 0) v = rand();
                return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
            };
            const PALETTE = [
                [0.30, 1.00, 0.78],   // teal-green
                [0.62, 1.00, 0.42],   // lime
                [1.00, 0.86, 0.48],   // gold
                [1.00, 0.45, 0.86],   // pink
                [0.45, 0.80, 1.00],   // sky
                [0.70, 0.56, 1.00],   // violet
                [0.96, 1.00, 0.92],   // white
            ];
            const pick = (weights: number[])=>{
                let t = rand() * weights.reduce( (a, b)=>(a + b), 0 );
                for (let i = 0; i < weights.length; i++) {
                    t -= weights[i];
                    if (t <= 0) return PALETTE[i];
                }
                return PALETTE[0];
            };
            // A point of the disc: an exponential disc in two arms, and a bulge at the middle.
            const disc = (bulgeShare: number)=>{
                const bulge = rand() < bulgeShare;
                const r = Math.min(1.25, bulge ? Math.abs(gauss()) * 0.08 : 0.05 - Math.log(1 - rand() * 0.985) * 0.27);
                const arm = (rand() < 0.5 ? 0 : Math.PI);
                const theta = bulge ? rand() * Math.PI * 2 : arm + Math.log(r + 0.04) * 2.4 + gauss() * (0.22 + 0.25 * r);
                const h = gauss() * (bulge ? 0.05 : 0.014) * (1.25 - Math.min(r, 1) * 0.7);
                return {r, theta, h, bulge};
            };
            // Gold at the middle, green through the arms, pink at the rim.
            const discColour = (r: number)=>{
                const t = Math.min(1, r);
                const core = [1.0, 0.88, 0.62], mid = [0.38, 1.0, 0.62], rim = [0.95, 0.42, 0.9];
                if (t < 0.28) return core.map( (v, k)=>(v + (mid[k] - v) * (t / 0.28)) );
                return mid.map( (v, k)=>(v + (rim[k] - v) * Math.pow((t - 0.28) / 0.72, 1.4)) );
            };
            const points = (n: number, one: (i: number)=>{p: number[], c: number[], a: number, s: number, inDisc: number})=>{
                const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), siz = new Float32Array(n * 3);
                for (let i = 0; i < n; i++) {
                    const {p, c, a, s, inDisc} = one(i);
                    pos.set(p, i * 3);
                    col.set([c[0], c[1], c[2], a], i * 4);
                    siz.set([s, rand(), inDisc], i * 3);
                }
                return {pos, col, siz};
            };
            return {
                rand, gauss,
                stars: (n: number)=>points(n, ()=>{
                    const warm = rand();
                    const c = (warm < 0.15) ? [1.0, 0.86, 0.68] : (warm < 0.35) ? [0.72, 0.86, 1.0] : [0.92, 0.94, 1.0];
                    return {p: [rand(), rand(), rand()], c, a: 0.12 + Math.pow(rand(), 2.4) * 0.88,
                            s: 1.0 + Math.pow(rand(), 3) * 1.8, inDisc: 0};
                }),
                galaxy: (n: number)=>points(n, ()=>{
                    const d = disc(0.1);
                    const c = (rand() < 0.07) ? pick([3, 1, 2, 2, 1, 1, 2]) : discColour(d.r);
                    return {p: [d.r, d.theta, d.h], c, a: (d.bulge ? 0.32 : 0.42) * (0.3 + rand() * 0.7),
                            s: 1.4 + rand() * 1.8 + (rand() < 0.03 ? 3.5 : 0), inDisc: 1};
                }),
                orbs: (n: number)=>points(n, ()=>{
                    const inDisc = (rand() < 0.7);
                    const d = disc(0.12);
                    const c = inDisc ? ((rand() < 0.5) ? discColour(d.r) : pick([5, 3, 3, 1, 1, 0.5, 1.5]))
                                     : pick([3, 2, 3, 1, 1, 1, 1]);
                    const p = inDisc ? [d.r, d.theta, d.h * 2] : [rand(), rand(), 0.4 + rand() * 0.6];
                    return {p, c, a: 0.35 + rand() * 0.55, s: 9 + Math.pow(rand(), 2.2) * 22, inDisc: inDisc ? 1 : 0};
                }),
            };
        },
    },

    SHADERS: {
        precision: 'precision mediump float;\n',
        pointsVs: `
attribute vec3 aPos;      // in the disc: (r, angle, height); on the sky: (x, y, depth)
attribute vec4 aColor;
attribute vec3 aSize;     // css px, twinkle phase, 1 = in the disc
uniform float uKind;      // 0 far stars, 1 the disc's dust, 2 bright stars
uniform float uTime;
uniform vec2 uViewport;
uniform float uDpr;
uniform vec2 uPan;
uniform float uTravel;
uniform float uAngle;
uniform vec3 uGalaxy;
uniform float uTilt;
uniform float uRoll;
varying vec4 vColor;
varying float vKind;
vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
void main() {
    float tw = 0.7 + 0.3 * sin(uTime * (0.5 + fract(aSize.y * 7.31) * 1.3) + aSize.y * 6.2831);
    float size = aSize.x;
    float fade = 1.0;
    vec2 p;
    if (aSize.z > 0.5) {
        float r = aPos.x;
        float a = aPos.y + uTime * 0.03 / (0.2 + r);
        vec3 d = vec3(cos(a) * r, aPos.z, sin(a) * r);
        float ct = cos(uTilt), st = sin(uTilt);
        d = vec3(d.x, d.y * ct - d.z * st, d.y * st + d.z * ct);
        float persp = 1.0 / (1.0 + d.z * 0.32);
        vec2 q = turn(vec2(d.x, d.y) * uGalaxy.z * min(uViewport.x, uViewport.y) * persp, uRoll);
        p = turn((uGalaxy.xy - 0.5) * uViewport + q, uAngle) + uPan * 0.012;
        size *= persp;
    } else {
        // A field twice the window, its stars at depths that a zoom flies through.
        float depth = fract(aPos.z + uTravel);
        float near = 1.0 / (0.35 + depth * 1.65);
        fade = smoothstep(0.0, 0.18, depth) * smoothstep(1.0, 0.8, depth);
        vec2 span = uViewport * 2.0;
        vec2 q = (aPos.xy - 0.5) * span * near;
        q = turn(q, uAngle) + uPan * (0.015 + 0.06 * near);
        q = mod(q + span * 0.5, span) - span * 0.5;
        p = q;
        size *= mix(0.8, 1.25, near);
    }
    vColor = vec4(aColor.rgb, aColor.a * fade * mix(1.0, tw, uKind > 1.5 ? 0.8 : 0.45));
    vKind = uKind;
    gl_Position = vec4(p / (uViewport * 0.5) * vec2(1.0, -1.0), 0.0, 1.0);
    gl_PointSize = max(1.0, size * uDpr);
}`,
        pointsFs: `
varying vec4 vColor;
varying float vKind;
void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(d, d);
    if (r2 > 1.0) discard;
    float a;
    if (vKind < 0.5) a = exp(-r2 * 7.0);
    else if (vKind < 1.5) a = exp(-r2 * 5.0) * 0.8 + exp(-r2 * 1.8) * 0.2;
    else a = exp(-r2 * 26.0) * 1.2 + exp(-r2 * 4.5) * 0.45 + exp(-r2 * 1.6) * 0.14;
    gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0);
}`,
        backdropVs: `
attribute vec2 aXY;
varying vec2 vXY;
void main() { vXY = aXY; gl_Position = vec4(aXY, 0.0, 1.0); }`,
        backdropFs: `
uniform sampler2D uTex;
uniform vec2 uViewport;
uniform vec2 uShift;
uniform float uAngle;
uniform vec3 uCore;
uniform float uTilt;
uniform float uRoll;
varying vec2 vXY;
vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
void main() {
    vec2 px = vXY * uViewport * 0.5 * vec2(1.0, -1.0);
    vec2 q = turn(px, -uAngle);
    vec3 col = texture2D(uTex, q / max(uViewport.x, uViewport.y) * 0.9 + 0.5 + uShift).rgb;
    // The core: an ellipse flattened by the tilt, gold in the middle and green further out.
    vec2 g = turn(px - uCore.xy, -(uRoll + uAngle));
    g.y /= max(0.12, sin(uTilt));
    float d = length(g) / uCore.z;
    col += vec3(1.0, 0.86, 0.6) * exp(-d * d * 90.0) * 0.5;
    col += vec3(0.3, 1.0, 0.6) * exp(-d * d * 7.0) * 0.12;
    col += vec3(0.6, 0.3, 0.9) * exp(-d * 2.2) * 0.06;
    // A dither, against banding in the dark gradients.
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor = vec4(col + (n - 0.5) / 255.0, 1.0);
}`,
    },
};

Universe.init();
