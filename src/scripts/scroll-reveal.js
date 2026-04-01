const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '50px 0px 0px 0px' }
);

document.querySelectorAll('.reveal').forEach((el) => {
  // If already in the viewport on load, make visible immediately (no animation delay)
  const rect = el.getBoundingClientRect();
  if (rect.top < window.innerHeight && rect.bottom > 0) {
    el.classList.add('visible');
  } else {
    observer.observe(el);
  }
});
