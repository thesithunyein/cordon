<p align="center">
  <img src="public/cordon-logo.png" alt="Cordon logo" width="120">
</p>

# C O R D O N

A full-screen immersive landing page for **Cordon**.

## Features

- Looping full-screen background video
- Glassmorphism octagonal (`clip-path`) button system — `.btn-cut`, `.btn-cut-border`, `.btn-cut-sm`
- Staggered fade-up entrance animations on every element
- Cordon "C" shield mark (logo + favicon)
- Fully responsive: single column on mobile → dual nav + 3-column bottom row on desktop

## Tech Stack

- React + TypeScript + Vite
- Tailwind CSS (Inter font, weights 300–900)
- lucide-react icons

## Getting Started

```bash
npm install
npm run dev      # start dev server
npm run build    # production build to /dist
npm run preview  # preview production build
```

## Structure

```
src/
├── App.tsx       # Full landing page layout (navbar, hero, bottom row)
├── index.css     # Tailwind, octagonal clip-path buttons, staggered animations
└── main.tsx      # Entry point
```

---

© 2026 Sithu Nyein
