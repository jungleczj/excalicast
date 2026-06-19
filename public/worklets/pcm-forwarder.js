// 提词器跟读：在「音频线程」取麦克风 PCM 帧并转发到主线程（喂给 vosk worker）。
// 用 AudioWorklet 替代主线程 ScriptProcessorNode —— 录制时主线程繁忙也不会饿死取帧，修跟读卡顿。
class PcmForwarder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      // 拷一份再传（worklet 输入缓冲会被复用）
      this.port.postMessage(new Float32Array(ch));
    }
    return true; // 保持存活
  }
}
registerProcessor('pcm-forwarder', PcmForwarder);
