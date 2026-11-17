export function flyProductToCart(source: HTMLImageElement | null, imageUrl: string) {
  const target = document.querySelector<HTMLElement>('[data-cart-target]');
  const badge = document.querySelector<HTMLElement>('[data-cart-count]');
  if (!target) return;

  target.classList.remove('cart-bounce');
  badge?.classList.remove('cart-badge-bounce');
  void target.offsetWidth;
  target.classList.add('cart-bounce');
  badge?.classList.add('cart-badge-bounce');
  target.addEventListener('animationend', () => target.classList.remove('cart-bounce'), { once: true });
  badge?.addEventListener('animationend', () => badge.classList.remove('cart-badge-bounce'), { once: true });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !source) return;
  const origin = source.getBoundingClientRect();
  const destination = target.getBoundingClientRect();
  if (!origin.width || !origin.height) return;

  const image = document.createElement('img');
  image.src = imageUrl;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  Object.assign(image.style, {
    position: 'fixed',
    zIndex: '100',
    left: `${origin.left}px`,
    top: `${origin.top}px`,
    width: `${origin.width}px`,
    height: `${origin.height}px`,
    objectFit: 'contain',
    borderRadius: '12px',
    pointerEvents: 'none',
    willChange: 'transform, opacity',
  });
  document.body.append(image);

  const dx = destination.left + destination.width / 2 - (origin.left + origin.width / 2);
  const dy = destination.top + destination.height / 2 - (origin.top + origin.height / 2);
  const animation = image.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0.15 },
  ], { duration: 520, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' });
  animation.addEventListener('finish', () => image.remove(), { once: true });
  animation.addEventListener('cancel', () => image.remove(), { once: true });
}
