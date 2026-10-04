"use strict";

class JellyMusic {
  static tracks = [
    {title:"Happy Adventure", artist:"TinyWorlds", src:"assets/bgm/happy-adventure.mp3"},
    {title:"Puzzling", artist:"Ruskerdax", src:"assets/bgm/puzzling.mp3"},
    {title:"My Street", artist:"congusbongus", src:"assets/bgm/my-street.ogg"},
    {title:"沈丁花（ピアノカラオケ）", artist:"NC J-POP Piano and Instruments for Karaoke", src:"assets/bgm/jinchoge.mp3"},
    {title:"沈丁花（メロディー）", artist:"Mobile Melody Series", src:"assets/bgm/jinchoge_melody.mp3"},
    {title:"四季刻歌（ピアノ）", artist:"Mr. D [Piano sheet music]", src:"assets/bgm/shikikokuka.mp3"}
  ];

  constructor(media = new Audio(), random = Math.random, notify = () => {}) {
    this.media = media; this.random = random; this.notify = notify;
    this.index = -1; this.active = false; this.failed = new Set();
    this.state = "idle"; this.request = 0; this.pending = false;
    media.preload = "none"; media.volume = .25;
    media.addEventListener("ended", () => { if (this.active) this.next(); });
    media.addEventListener("error", () => this.failTrack());
  }

  get track() { return JellyMusic.tracks[this.index]; }
  update(state) { this.state = state; this.notify(this); }
  setVolume(value) { this.media.volume = Math.max(0, Math.min(1, value)); }

  next() {
    const available = JellyMusic.tracks.map((_, index) => index).filter(index => !this.failed.has(index));
    const other = available.filter(index => index !== this.index);
    const choices = other.length ? other : available;
    this.stop();
    if (!choices.length) { this.update("unavailable"); return; }
    this.index = choices[Math.floor(this.random() * choices.length)];
    this.media.src = this.track.src;
    this.update("idle");
    if (this.active) this.play();
  }

  stop() {
    this.request++; this.pending = false; this.media.pause();
  }

  setActive(active) {
    this.active = active;
    if (!active) { this.stop(); return; }
    if (this.index < 0) this.next();
    else this.play();
  }

  play() {
    if (!this.active || this.pending || this.state === "unavailable") return;
    if (!this.media.paused && !this.media.ended) return;
    const request = ++this.request;
    this.pending = true; this.update("loading");
    try {
      Promise.resolve(this.media.play()).then(() => {
        if (request !== this.request) return;
        this.pending = false;
        if (!this.active) { this.media.pause(); return; }
        this.update("playing");
      }).catch(error => this.playFailed(error, request));
    } catch (error) { this.playFailed(error, request); }
  }

  playFailed(error, request) {
    if (request !== this.request) return;
    this.pending = false;
    if (error.name === "NotAllowedError" || error.name === "AbortError") this.update("blocked");
    else this.failTrack();
  }

  failTrack() {
    if (this.index < 0 || this.failed.has(this.index)) return;
    this.failed.add(this.index);
    this.next();
  }
}
