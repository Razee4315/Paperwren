/**
 * All scroll and load motion (docs/14-website.md, "Motion inventory").
 * Nothing here runs with prefers-reduced-motion: the markup and CSS
 * already render every element in its final state.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

const EXPO = "expo.out";
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
	Array.from(root.querySelectorAll<T & Element>(sel)) as T[];

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
	smoothScroll();
	document.fonts.ready.then(() => {
		hero();
		headings();
		reveals();
		formatCards();
		strike();
		parallax();
		odometers();
		ScrollTrigger.refresh();
	});
}

/** Lenis on fine pointers only, driven by the GSAP ticker so there is
 * one animation loop. Touch devices keep native scrolling. */
function smoothScroll() {
	if (!matchMedia("(pointer: fine)").matches) return;
	const lenis = new Lenis({ lerp: 0.1, autoRaf: false });
	lenis.on("scroll", ScrollTrigger.update);
	gsap.ticker.add((t) => lenis.raf(t * 1000));
	gsap.ticker.lagSmoothing(0);
	for (const a of $$<HTMLAnchorElement>('a[href*="#"]')) {
		a.addEventListener("click", (e) => {
			const u = new URL(a.href);
			if (u.pathname !== location.pathname || !u.hash) return;
			const target = document.querySelector(u.hash);
			if (!target) return;
			e.preventDefault();
			lenis.scrollTo(target as HTMLElement, { offset: -60, duration: 1.4 });
			history.pushState(null, "", u.hash);
		});
	}
}

/** Unmasked headings preserve the full letter shapes at every size. */
function hero() {
	const title = document.querySelector<HTMLElement>("[data-hero=title]");
	if (!title) return;
	gsap.set("[data-hero]", { visibility: "visible" });

	gsap
		.timeline({ defaults: { ease: EXPO, duration: 1.2 } })
		.from(title, { y: 28, opacity: 0, duration: 1 })
		.from("[data-hero=kicker]", { y: 14, autoAlpha: 0 }, 0.1)
		.from("[data-hero=copy]", { y: 26, autoAlpha: 0 }, 0.5)
		.from("[data-hero=cta]", { autoAlpha: 0, stagger: 0.08 }, 0.4);
}

/** Gentle heading reveals without clipping glyphs. */
function headings() {
 for (const el of $$("[data-split]")) {
  gsap.from(el, { y: 24, opacity: 0, duration: .8, ease: EXPO,
   scrollTrigger: { trigger: el, start: "top 92%", once: true } });
 }
}

function reveals() {
	gsap.set("[data-reveal]", { autoAlpha: 0, y: 44 });
	ScrollTrigger.batch("[data-reveal]", {
		start: "top 90%",
		once: true,
		onEnter: (els) =>
			gsap.to(els, { autoAlpha: 1, y: 0, duration: 1.2, stagger: 0.09, ease: EXPO }),
	});
}

/** The signature move: every obstacle is struck through as you
 * scroll, the list falls away, and one line is left. */
function strike() {
	const section = document.querySelector<HTMLElement>("[data-strike]");
	if (!section) return;
	const items = $$(".strike-item", section);
	const final = section.querySelector("[data-strike-final]");
	const tl = gsap.timeline({
		scrollTrigger: {
			trigger: section,
			start: "top top",
			end: "bottom center",
			toggleActions: "play none none none",
			invalidateOnRefresh: true,
		},
	});
	for (const item of items) {
		tl.to(item.querySelector("path"), { strokeDashoffset: 0, duration: 0.18, ease: "power2.inOut" }).to(
			item.querySelector(".t"),
			{ color: "#8f887b", x: 6, duration: 0.5, ease: "power1.out" },
			"<0.45",
		);
	}
	tl.to(items, {
		y: 80,
		rotate: (i) => (i % 2 ? 3 : -2.5),
		autoAlpha: 0,
		stagger: 0.06,
		duration: 0.9,
		ease: "power2.in",
	}, "+=0.4");
	if (final) {
		tl.fromTo(
			final.querySelectorAll("[data-final-part]"),
			{ y: 70, autoAlpha: 0 },
			{ y: 0, autoAlpha: 1, stagger: 0.15, duration: 1.1, ease: EXPO },
			"-=0.25",
		);
	}
	tl.to({}, { duration: 0.6 });
}

/** Elements drift against the scroll at their own speed. */
function parallax() {
	for (const el of $$("[data-speed]")) {
		const speed = Number(el.dataset.speed) || 0.1;
		const trigger = el.closest("[data-parallax-root]") ?? el;
		gsap.fromTo(
			el,
			{ yPercent: speed * 100 },
			{
				yPercent: -speed * 100,
				ease: "none",
				scrollTrigger: { trigger, start: "top bottom", end: "bottom top", scrub: true },
			},
		);
	}
	for (const el of $$("[data-scale]")) {
		gsap.fromTo(
			el,
			{ scale: 0.88 },
			{
				scale: 1,
				ease: "none",
				scrollTrigger: { trigger: el, start: "top bottom", end: "center 55%", scrub: true },
			},
		);
	}
	const heroFade = document.querySelector("[data-hero-exit]");
	if (heroFade) {
		gsap.to(heroFade, {
			y: -80,
			autoAlpha: 0.2,
			ease: "none",
			scrollTrigger: { trigger: heroFade, start: "top top", end: "bottom top", scrub: true },
		});
	}
}

/** Digits roll down to zero when the ledger row enters. */
function odometers() {
	for (const strip of $$(".odo-strip")) {
		const n = strip.children.length;
		gsap.fromTo(
			strip,
			{ yPercent: 0 },
			{
				yPercent: (-(n - 1) / n) * 100,
				duration: 2.2,
				ease: "expo.inOut",
				scrollTrigger: { trigger: strip, start: "top 85%", once: true },
			},
		);
	}
}

/** Start level, then fan the complete phones and captions as the row passes. */
function formatCards() {
 const cards = $$("[data-format-card]");
 const mm = gsap.matchMedia();
 mm.add("(min-width: 861px)", () => {
  cards.forEach((card, i) => {
   gsap.fromTo(card, { y: 0, rotation: 0, scale: 1 }, {
    y: i % 2 ? 28 : -38, rotation: [-3, 2, -2, 3][i], scale: .96, ease: "none",
    scrollTrigger: { trigger: ".phones", start: "top 48%", end: "bottom 25%", scrub: .8 },
   });
  });
 });
}
