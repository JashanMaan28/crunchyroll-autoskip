import '../styles/site.css'

// Navigation: mark the current page, solid background once scrolled, and the
// menu button on small screens.
const nav = document.querySelector<HTMLElement>('[data-nav]')
const page = document.body.dataset.page
document.querySelectorAll<HTMLAnchorElement>('.nav__links a[data-page]').forEach((a) => {
  if (a.dataset.page === page) a.setAttribute('aria-current', 'page')
})

if (nav) {
  const solid = () => nav.toggleAttribute('data-solid', scrollY > 8 || page !== 'home')
  solid()
  addEventListener('scroll', solid, { passive: true })

  const button = nav.querySelector<HTMLButtonElement>('[data-menu]')
  const close = () => {
    nav.removeAttribute('data-open')
    button?.setAttribute('aria-expanded', 'false')
  }
  button?.addEventListener('click', () => {
    const open = !nav.hasAttribute('data-open')
    nav.toggleAttribute('data-open', open)
    button.setAttribute('aria-expanded', String(open))
  })
  nav.querySelectorAll('.nav__links a').forEach((a) => a.addEventListener('click', close))
  addEventListener('keydown', (e) => e.key === 'Escape' && close())
}

// One reveal per page at most: elements marked data-reveal play their
// entrance once when they first come into view.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.setAttribute('data-shown', '')
      io.unobserve(e.target)
    }
  },
  { rootMargin: '0px 0px -15% 0px' },
)
document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el))

// The guide's table of contents follows the section being read.
const toc = document.querySelectorAll<HTMLAnchorElement>('.guide__toc a')
if (toc.length) {
  const heads = [...toc].map((a) => document.querySelector(a.hash)).filter(Boolean) as Element[]
  const spy = () => {
    let cur = heads[0]
    for (const h of heads) if (h.getBoundingClientRect().top < 140) cur = h
    toc.forEach((a) => a.setAttribute('aria-current', String(a.hash === `#${cur?.id}`)))
  }
  spy()
  addEventListener('scroll', spy, { passive: true })
}
