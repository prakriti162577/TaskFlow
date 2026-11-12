// Animated shader gradient background. Renders at low resolution so it stays pixelated and cheap.
(function () {
    var canvas = document.getElementById("shader");
    if (!canvas) return;
    var gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return; // CSS gradient fallback stays visible

    var PALETTES = {
        light: ["#d3e6bb", "#f8dcae", "#f2a98f", "#9fd0c4"],
        dark: ["#0b1a17", "#1a3a32", "#35304f", "#5b3d2c"]
    };
    var CELL = 5; // size of one "pixel" in CSS px

    var vs = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }";
    var fs = [
        "precision mediump float;",
        "uniform vec2 r; uniform float t; uniform vec3 c0, c1, c2, c3;",
        "void main(){",
        "  vec2 uv = gl_FragCoord.xy / r;",
        "  vec2 p = vec2(uv.x * r.x / r.y, uv.y);",
        "  float n = sin(p.x * 2.2 + t * .25)",
        "          + sin(p.y * 3.1 - t * .20 + sin(p.x * 1.7 + t * .15) * 1.5)",
        "          + sin((p.x + p.y) * 2.6 + t * .18);",
        "  n = n / 6. + .5;",
        "  vec3 col = mix(c0, c1, smoothstep(0., .5, n));",
        "  col = mix(col, c2, smoothstep(.4, .85, n) * .9);",
        "  col = mix(col, c3, (1. - uv.y) * .55 * (.5 + .5 * sin(p.x * 1.3 + t * .1)));",
        "  col = floor(col * 18. + .5) / 18.;", // posterize for a retro look
        "  gl_FragColor = vec4(col, 1.);",
        "}"
    ].join("\n");

    function compile(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uR = gl.getUniformLocation(prog, "r");
    var uT = gl.getUniformLocation(prog, "t");
    var uC = [0, 1, 2, 3].map(function (i) { return gl.getUniformLocation(prog, "c" + i); });

    function hex(h) {
        return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; });
    }

    function themeName() {
        return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    }

    var current = PALETTES[themeName()].map(hex);
    var target = current.map(function (c) { return c.slice(); });

    new MutationObserver(function () {
        target = PALETTES[themeName()].map(hex);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    function resize() {
        canvas.width = Math.max(1, Math.ceil(window.innerWidth / CELL));
        canvas.height = Math.max(1, Math.ceil(window.innerHeight / CELL));
        gl.viewport(0, 0, canvas.width, canvas.height);
    }
    window.addEventListener("resize", resize);
    resize();

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var start = performance.now();

    function frame(now) {
        for (var i = 0; i < 4; i++) {
            for (var k = 0; k < 3; k++) current[i][k] += (target[i][k] - current[i][k]) * 0.06;
            gl.uniform3fv(uC[i], current[i]);
        }
        gl.uniform2f(uR, canvas.width, canvas.height);
        gl.uniform1f(uT, reduce ? 4 : (now - start) / 1000);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (!reduce && !document.hidden) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden && !reduce) requestAnimationFrame(frame);
    });
})();