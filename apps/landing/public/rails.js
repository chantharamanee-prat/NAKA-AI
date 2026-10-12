// Clip sections on the home page (#reel, markup from creative/unsloth-reel/build-reel.cjs; the English page
// writes its own). Each studio menu shows its clips as a grid: two rows at first, however many columns the
// screen fits, and "ดูอีก N คลิป" opens two more rows below each time, so nothing scrolls sideways. Posters past
// the first row load only once their card is shown and the section is near the screen.
// Playback is landing.js's: a clip plays while it is on screen; hidden cards never are.
(function () {
  'use strict';
  var root = document.querySelector('[data-gallery]') || document.querySelector('#reel');
  var rails = Array.prototype.slice.call(document.querySelectorAll('[data-rail]'));
  if (!rails.length) return;
  var ROWS = 2;

  function columns(track) {
    var cols = getComputedStyle(track).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  }

  rails.forEach(function (rail) {
    var track = rail.querySelector('.g-track');
    var button = rail.querySelector('[data-more]');
    var count = rail.querySelector('[data-more-count]');
    if (!track) return;
    var cards = Array.prototype.slice.call(track.children).filter(function (el) { return el.classList.contains('g-card'); });
    var rows = ROWS;
    var near = !('IntersectionObserver' in window);

    function render() {
      var shown = columns(track) * rows;
      cards.forEach(function (card, i) {
        card.hidden = i >= shown;
        var v = card.querySelector('video[data-poster]');
        if (v && near && !card.hidden) {
          v.setAttribute('poster', v.getAttribute('data-poster'));
          v.removeAttribute('data-poster');
        }
      });
      var left = Math.max(0, cards.length - shown);
      if (button) button.hidden = left === 0;
      if (count) count.textContent = String(left);
    }

    if (button) {
      button.addEventListener('click', function () {
        var before = columns(track) * rows;
        rows += ROWS;
        render();
        // keep a keyboard user's place: the first new card's link takes focus
        var first = cards[before] && cards[before].querySelector('a, button');
        if (first) first.focus({ preventScroll: true });
      });
    }
    if (!near) {
      var watch = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { near = true; render(); watch.disconnect(); }
      }, { rootMargin: '600px 0px' });
      watch.observe(track);
    }
    var raf = 0;
    window.addEventListener('resize', function () {
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); });
    });
    render();
  });
  if (root) root.setAttribute('data-ready', '');
})();
