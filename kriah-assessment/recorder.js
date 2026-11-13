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
    // MediaRecorder's wall-clock timer is not proof that the encoded blob contains
    // that much playable audio. Validate independently when the browser can decode.
    // Unknown/unsupported codecs are left to the normal local preview, not rejected.
    static async verifyPlayableDuration(blob, elapsed, { Decoder = root.AudioContext || root.webkitAudioContext } = {}) {
      if (!Number.isFinite(elapsed) || elapsed < 3 || !Decoder) return { checked: false };
      let decoder;
      try {
        decoder = new Decoder();
        const samples = await blob.arrayBuffer();
        // decodeAudioData may consume/detach its input buffer.
        const audio = await decoder.decodeAudioData(samples);
        const playable = audio.duration;
        if (Number.isFinite(playable) && playable > 0) {
          if (playable + Math.max(2, elapsed * 0.12) < elapsed) {
            throw Object.assign(new Error('The recording appears cut off (' + Math.round(playable) + 's of ' + Math.round(elapsed) + 's). Please record again; it was not submitted.'), { kriahTruncated: true });
          }
          return { checked: true, playable };
        }
      } catch (error) {
        if (error.kriahTruncated) throw error;
        // Codec support varies between browsers, particularly Safari/MP4.
        // A failed decode alone is not evidence of truncation.
      } finally {
        try { await decoder?.close(); } catch (_) {}
      }
      return { checked: false };
    }
    // Decode the whole recording and report its real audio length. Returns null
    // when this browser cannot decode the format (that alone is not an error).
    // toWav() gives a plain PCM copy for playback only; the stored original is
    // never changed.
    static async inspect(blob, { Decoder = root.AudioContext || root.webkitAudioContext } = {}) {
      if (!Decoder || !blob?.size) return null;
      let decoder;
      try {
        decoder = new Decoder();
        const audio = await decoder.decodeAudioData(await blob.arrayBuffer());
        if (!Number.isFinite(audio?.duration) || audio.duration <= 0) return null;
        return { duration: audio.duration, toWav: () => KriahRecorder.wav(audio) };
      } catch (_) { return null; } finally { try { await decoder?.close(); } catch (_) {} }
    }
    // Mono 16-bit WAV: every browser reports its exact length and can seek it.
    static wav(audio) {
      const channels = audio.numberOfChannels, length = audio.length, rate = audio.sampleRate;
      const data = new DataView(new ArrayBuffer(44 + length * 2));
      const text = (offset, value) => { for (let i = 0; i < value.length; i++) data.setUint8(offset + i, value.charCodeAt(i)); };
      text(0, 'RIFF'); data.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
      data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
      text(36, 'data'); data.setUint32(40, length * 2, true);
      const parts = []; for (let c = 0; c < channels; c++) parts.push(audio.getChannelData(c));
      for (let i = 0; i < length; i++) {
        let sample = 0; for (let c = 0; c < channels; c++) sample += parts[c][i];
        sample = Math.max(-1, Math.min(1, sample / channels));
        data.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      return new Blob([data.buffer], { type: 'audio/wav' });
    }
    // MediaRecorder WebM files carry no length, so a player reports Infinity
    // until it has been sent to the end once. Wait for that seek to really
    // finish: a length reported part-way through can be far too short.
    // Resolves with the player's final length in seconds, or null if unknown.
    static resolveDuration(player, { timeout = 8000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
      return new Promise(resolve => {
        let done = false, probing = false, reachedEnd = false, timer = null;
        const known = () => Number.isFinite(player.duration) && player.duration > 0;
        const finish = () => {
          if (done) return; done = true; clearTimer(timer);
          handlers.forEach(([name, fn]) => player.removeEventListener(name, fn));
          if (probing) { try { player.currentTime = 0; } catch (_) {} }
          resolve(known() ? player.duration : null);
        };
        const begin = () => {
          if (done || probing) return;
          if (known()) { finish(); return; }
          probing = true;
          try { player.currentTime = 1e101; } catch (_) { finish(); }
        };
        const arrived = () => { if (!probing) return; reachedEnd = true; if (known()) finish(); };
        const changed = () => { if (!probing) { if (known()) finish(); } else if (reachedEnd && known()) finish(); };
        const handlers = [['loadedmetadata', begin], ['seeked', arrived], ['ended', arrived], ['durationchange', changed], ['error', finish]];
        handlers.forEach(([name, fn]) => player.addEventListener(name, fn));
        timer = setTimer(finish, timeout);
        if (player.readyState >= 1) begin();
      });
    }
    stop() { if (this.state === 'recording') { this.state = 'stopping'; this.recorder.stop(); } }
    cleanup() { clearInterval(this.timer); this.timer = null; this.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.stream = null; }
    cancel() { this.cancelled = true; this.session++; this.stop(); this.cleanup(); this.state = 'idle'; }
  }
  if (typeof module === 'object' && module.exports) module.exports = KriahRecorder; else root.KriahRecorder = KriahRecorder;
})(typeof window === 'object' ? window : globalThis);
