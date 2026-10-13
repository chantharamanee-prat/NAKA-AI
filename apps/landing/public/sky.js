// After-rain sky (sky.css): the clouds only drift while their band is on screen and the tab is visible.
// ?t=N freezes every sky layer N seconds into its loop, so any moment can be screenshotted.
(() => {
  const skies = [...document.querySelectorAll("[data-sky]")];
  if (!skies.length) return;

  const t = parseFloat(new URLSearchParams(location.search).get("t"));
  if (Number.isFinite(t)) {
    for (const sky of skies) {
      for (const layer of sky.querySelectorAll("i")) {
        const delay = parseFloat(getComputedStyle(layer).animationDelay) || 0;
        layer.style.animationDelay = `${delay - t}s`;
        layer.style.animationPlayState = "paused";
      }
    }
    window.__skyReady = true;
    return;
  }

  const offscreen = new Set();
  const apply = (sky) => sky.classList.toggle("is-paused", document.hidden || offscreen.has(sky));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) offscreen.delete(e.target);
        else offscreen.add(e.target);
        apply(e.target);
      }
    });
    skies.forEach((sky) => io.observe(sky));
  }
  document.addEventListener("visibilitychange", () => skies.forEach(apply));
  window.__skyReady = true;
})();
