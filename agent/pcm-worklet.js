// agent/pcm-worklet.js — Role 3. AudioWorklet: forwards mic samples (Float32, mono) to voice.js.
// The AudioContext runs at 16 kHz, so these are already 16 kHz; voice.js packs them into 100 ms PCM16 chunks.
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
