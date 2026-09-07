# V O R T X — VortxLab Creations

A full-screen immersive landing page for the creative-tech studio **VortxLab Creations**.

## Features

- Looping full-screen background video
- Glassmorphism octagonal (`clip-path`) button system — `.btn-cut`, `.btn-cut-border`, `.btn-cut-sm`
- Staggered fade-up entrance animations on every element
- Custom vortex SVG logo with "V O R T X" wordmark
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
