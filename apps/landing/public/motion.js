// Home page motion (motion.css): sections and cards rise in as they scroll into view, in a 60 ms cascade
// capped at 600 ms (animation-principles). Only what is still below the fold when this runs gets hidden,
// so nothing already on screen blinks and nothing stays hidden if this file never loads.
// ?t=N pauses every CSS animation N seconds in (logo, hero, sky) and shows all sections, for screenshots.
(() => {
  const freeze = parseFloat(new URLSearchParams(location.search).get("t"));
  if (Number.isFinite(freeze)) {
    const pin = () => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = freeze * 1000; });
    requestAnimationFrame(pin);
    addEventListener("load", pin);
    window.__motionReady = true;
    return;
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

  const SEL = [
    ".u-head", ".g-head", ".g-rail-head", ".g-track", ".st-grid > li", ".st-note",
    ".s-list > li", ".s-cta", ".t-stats > div", ".t-list > li", ".c-end .shell > *",
  ].join(",");
  const fold = innerHeight * 0.92;
  const items = [...document.querySelectorAll(SEL)].filter((el) => el.getBoundingClientRect().top > fold);

  const io = new IntersectionObserver((entries) => {
    const entering = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    entering.forEach((e, i) => {
      const el = e.target;
      el.style.transitionDelay = `${Math.min(i * 60, 600)}ms`;
      el.classList.add("rv-in");
      io.unobserve(el);
      setTimeout(() => { el.style.transitionDelay = ""; el.classList.remove("rv", "rv-in"); }, 1500);
    });
  }, { rootMargin: "0px 0px -6% 0px" });

  for (const el of items) {
    el.classList.add("rv");
    io.observe(el);
  }
})();
