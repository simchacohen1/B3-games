(function (root) {
  'use strict';
  class KriahRecorder {
    constructor({ media = root.navigator?.mediaDevices, Recorder = root.MediaRecorder, onTick = () => {}, onComplete = () => {}, onError = () => {}, clock = Date.now } = {}) {
      Object.assign(this, { media, Recorder, onTick, onComplete, onError, clock });
      this.state = 'idle'; this.stream = null; this.timer = null; this.cancelled = false; this.session = 0;
    }
    async start() {
      if (this.state !== 'idle') throw new Error('Recorder is already active.');
      if (!this.media?.getUserMedia || !this.Recorder) throw new Error('Recording is unavailable. Use a current browser with microphone access.');
      this.state = 'requesting'; this.cancelled = false; const session = ++this.session;
      try {
        const stream = await this.media.getUserMedia({ audio: true });
        if (this.cancelled || session !== this.session) { stream.getTracks().forEach(t => t.stop()); if (session === this.session) this.state = 'idle'; return; }
        this.stream = stream;
        const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => this.Recorder.isTypeSupported?.(t));
        this.recorder = new this.Recorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
        const chunks = []; let size = 0;
        this.recorder.ondataavailable = event => {
          if (session !== this.session) return;
          if (event.data?.size) { chunks.push(event.data); size += event.data.size; }
          if (size >= 1900000 && this.state === 'recording') this.stop();
        };
        this.recorder.onerror = () => { if (session !== this.session) return; this.cancelled = true; this.cleanup(); this.state = 'idle'; this.onError(new Error('Recording was interrupted. Please record again.')); };
        this.recorder.onstop = async () => {
          if (session !== this.session) return;
          const duration = Math.min(300, (this.clock() - this.startedAt) / 1000);
          this.cleanup(); this.state = 'idle';
          if (this.cancelled) return;
          const blob = new Blob(chunks, { type: (this.recorder.mimeType || type || 'audio/webm').split(';')[0] });
          if (!blob.size || blob.size > 2 * 1024 * 1024 || duration < 0.3) { this.onError(new Error('Recording was too short or too large. Please try again.')); return; }
          try { await this.onComplete({ blob, duration }); } catch (error) { this.onError(error); }
        };
        stream.getTracks().forEach(track => { track.onended = () => { if (this.state === 'recording') this.stop(); }; });
        this.startedAt = this.clock(); this.recorder.start(1000); this.state = 'recording';
        this.timer = setInterval(() => { const seconds = (this.clock() - this.startedAt) / 1000; this.onTick(seconds); if (seconds >= 299) this.stop(); }, 250);
      } catch (error) {
        if (session !== this.session) return;
        this.cleanup(); this.state = 'idle';
        throw new Error(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in browser settings and try again.' : 'Could not start the microphone. Check the device and try again.');
      }
    }
    stop() { if (this.state === 'recording') { this.state = 'stopping'; this.recorder.stop(); } }
    cleanup() { clearInterval(this.timer); this.timer = null; this.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.stream = null; }
    cancel() { this.cancelled = true; this.session++; this.stop(); this.cleanup(); this.state = 'idle'; }
  }
  if (typeof module === 'object' && module.exports) module.exports = KriahRecorder; else root.KriahRecorder = KriahRecorder;
})(typeof window === 'object' ? window : globalThis);
