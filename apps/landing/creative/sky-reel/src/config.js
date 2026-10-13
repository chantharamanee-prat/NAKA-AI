// One beat table for the picture (index.html) and the sound (scripts/generate-audio.mjs).
// Loaded as a plain script in the page and imported as a module by Node; it only sets globalThis.CFG.
(function () {
  var BPM = 120;
  var SEC_PER_BEAT = 60 / BPM;
  globalThis.CFG = {
    W: 1920,
    H: 1080,
    FPS: 60,
    BPM: BPM,
    SEC_PER_BEAT: SEC_PER_BEAT,
    DURATION_SEC: 15,
    b: function (n) { return n * SEC_PER_BEAT; },
    colors: {
      ground: "#F3F7FB",
      ink: "#14233B",
      brand: "#1D50BE",
      accent: "#F97316",
    },
    // cues in beats; every visual and sonic event reads from here
    cue: {
      pains: [0.5, 2, 3.5],
      freeze: 6,
      drop: 7,
      impact: 8,
      nodeShrink: 10.5,
      phonesOut: 11,
      punches: [12, 13, 14, 15],
      clearFrom: 12,
      clearTo: 22,
      riser: 18,
      whip: 19.5,
      sun: 20,
      naka: 20.5,
      line2: 21,
      logo: 26,
      logoHead: 27,
      tagline: 27.5,
    },
  };
})();
