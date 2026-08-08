'use client';

export interface DisplayBlurWorker {
  blur(frame: CanvasImageSource): Promise<ImageBitmap | null>;
  close(): void;
}

function workerSource(): string {
  return `
    let canvas, gl, program, texture, sourceSize, targetSize;
    const vertex = \`#version 300 es
      const vec2 positions[3] = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));
      out vec2 uv;
      void main() { vec2 p = positions[gl_VertexID]; uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }
    \`;
    const fragment = \`#version 300 es
      precision highp float;
      in vec2 uv;
      out vec4 color;
      uniform sampler2D image;
      uniform vec2 sourceSize;
      uniform vec2 targetSize;
      vec2 coverUv(vec2 p) {
        float sourceAspect = sourceSize.x / sourceSize.y;
        float targetAspect = targetSize.x / targetSize.y;
        if (sourceAspect > targetAspect) {
          float visible = targetAspect / sourceAspect;
          p.x = (p.x - .5) * visible + .5;
        } else {
          float visible = sourceAspect / targetAspect;
          p.y = (p.y - .5) * visible + .5;
        }
        return p;
      }
      void main() {
        vec2 p = coverUv(uv);
        vec2 d = 10. / sourceSize;
        vec4 sum = texture(image, p) * .20;
        sum += texture(image, p + vec2( d.x, 0.)) * .12;
        sum += texture(image, p + vec2(-d.x, 0.)) * .12;
        sum += texture(image, p + vec2(0.,  d.y)) * .12;
        sum += texture(image, p + vec2(0., -d.y)) * .12;
        sum += texture(image, p + vec2( d.x,  d.y)) * .08;
        sum += texture(image, p + vec2(-d.x,  d.y)) * .08;
        sum += texture(image, p + vec2( d.x, -d.y)) * .08;
        sum += texture(image, p + vec2(-d.x, -d.y)) * .08;
        color = sum;
      }
    \`;
    function shader(type, source) {
      const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item);
      if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
      return item;
    }
    function init(data) {
      canvas = new OffscreenCanvas(data.width, data.height);
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, desynchronized: true });
      if (!gl) throw new Error('webgl2_unavailable');
      program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      sourceSize = gl.getUniformLocation(program, 'sourceSize');
      targetSize = gl.getUniformLocation(program, 'targetSize');
      gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
      gl.viewport(0, 0, data.width, data.height);
    }
    self.onmessage = (event) => {
      const data = event.data;
      try {
        if (data.type === 'init') { init(data); self.postMessage({ type: 'ready' }); return; }
        const frame = data.frame;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        gl.uniform2f(sourceSize, frame.displayWidth || frame.codedWidth, frame.displayHeight || frame.codedHeight);
        gl.uniform2f(targetSize, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        frame.close();
        const bitmap = canvas.transferToImageBitmap();
        self.postMessage({ type: 'frame', id: data.id, bitmap }, [bitmap]);
      } catch (error) {
        try { data.frame?.close(); } catch {}
        self.postMessage({ type: 'error', id: data.id, message: error instanceof Error ? error.message : String(error) });
      }
    };
  `;
}

export function createDisplayBlurWorker(width: number, height: number): DisplayBlurWorker | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const pending = new Map<number, (bitmap: ImageBitmap | null) => void>();
  let nextId = 1;
  let available = true;
  worker.onmessage = (event: MessageEvent<{ type: string; id?: number; bitmap?: ImageBitmap }>) => {
    if (event.data.type === 'error') available = false;
    if (event.data.id === undefined) return;
    const resolve = pending.get(event.data.id);
    if (!resolve) return;
    pending.delete(event.data.id);
    resolve(event.data.bitmap ?? null);
  };
  worker.onerror = () => {
    available = false;
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
  };
  worker.postMessage({ type: 'init', width: Math.max(2, Math.ceil(width / 8)), height: Math.max(2, Math.ceil(height / 8)) });

  return {
    blur(frame) {
      if (!available || !(frame instanceof VideoFrame)) return Promise.resolve(null);
      let clone: VideoFrame;
      try { clone = new VideoFrame(frame); } catch { return Promise.resolve(null); }
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        worker.postMessage({ type: 'frame', id, frame: clone }, [clone]);
      });
    },
    close() {
      available = false;
      worker.terminate();
      URL.revokeObjectURL(url);
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
    },
  };
}
