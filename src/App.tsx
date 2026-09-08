import { ArrowRight } from 'lucide-react'

function CordonLogo() {
  return (
    <img
      src="/cordon-logo.png"
      alt="Cordon"
      className="w-24 h-24 md:w-28 md:h-28 object-contain"
    />
  )
}

function XIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

export default function App() {
  return (
    <div className="h-screen w-full bg-black p-3 md:p-4 font-inter">
      <div className="w-full h-full rounded-2xl flex flex-col overflow-hidden relative bg-black">
        {/* Background Video */}
        <video
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260717_120352_eb988725-1351-43b3-8095-16e4a1005e3d.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover anim-fade"
          style={{ animationDelay: '0.2s' }}
        />

        {/* Navbar */}
        <nav className="relative z-10 flex items-center justify-between px-6 md:px-10 pt-6 md:pt-8">
          {/* Logo */}
          <div className="anim-stagger" style={{ animationDelay: '0.1s' }}>
            <CordonLogo />
            <span className="text-white text-sm md:text-base tracking-normal mt-2 block font-light">
              CORDON
            </span>
          </div>

          {/* Nav Buttons */}
          <div
            className="flex items-center gap-3 anim-stagger"
            style={{ animationDelay: '0.2s' }}
          >
            <button className="hidden md:block px-5 py-2.5 text-white text-sm hover:bg-white/10 btn-cut-border transition-colors">
              <span>Neural Synergy</span>
            </button>
            <button className="hidden md:block px-5 py-2.5 bg-white text-black text-sm hover:bg-white/90 btn-cut transition-colors">
              Cyber Synthesis
            </button>
          </div>
        </nav>

        {/* Main Content */}
        <div className="relative z-10 flex-1 flex flex-col justify-between px-6 md:px-10 pb-8 md:pb-10">
          {/* Top Section */}
          <div className="flex-1 flex items-center relative">
            {/* Left Column (hidden below lg) */}
            <div
              className="hidden lg:flex flex-col gap-6 absolute left-0 top-[18%] anim-stagger"
              style={{ animationDelay: '0.4s' }}
            >
              <p className="text-white/80 text-base leading-relaxed max-w-[220px]">
                Come with us<br />
                exploring the<br />
                horizon
              </p>
              <div className="flex flex-col gap-2 mt-4">
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded-full border border-white/40" />
                  <div className="w-4 h-4 rounded-full border border-white/40" />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-white/70 text-xs">
                    Perpetual<br />Immersion
                  </span>
                  <span className="text-white/50 text-xs">01</span>
                </div>
              </div>
            </div>

            {/* Center Heading */}
            <div
              className="w-full text-center anim-stagger"
              style={{ animationDelay: '0.5s' }}
            >
              <h1
                className="text-white text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-normal leading-[1.1] tracking-[-0.04em]"
                style={{ textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}
              >
                Forging Tomorrow<br />
                Virtual Horizon<br />
                Cordon
              </h1>
            </div>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center mt-8">
            {/* Col 1 */}
            <div
              className="flex items-center justify-center md:justify-end anim-stagger"
              style={{ animationDelay: '0.7s' }}
            >
              <p className="text-white text-sm leading-relaxed max-w-[260px] text-center md:text-left md:ml-auto">
                We push past conventions, reshaping the virtual terrain with next-level technologies.
              </p>
            </div>

            {/* Col 2 */}
            <div
              className="flex flex-col items-center gap-8 md:gap-24 anim-stagger"
              style={{ animationDelay: '0.85s' }}
            >
              <span className="text-white text-2xl md:text-3xl font-medium">
                Net Dynamics
              </span>
              <button className="w-full max-w-[280px] py-3.5 bg-white flex items-center justify-center gap-2 text-black hover:bg-white/90 transition-colors group btn-cut">
                <span className="text-sm font-medium">Discover Now</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            {/* Col 3 */}
            <div
              className="flex items-center justify-center md:justify-end gap-3 anim-stagger"
              style={{ animationDelay: '1s' }}
            >
              <button className="w-10 h-10 bg-white flex items-center justify-center text-black hover:bg-white/90 transition-colors btn-cut-sm">
                <XIcon />
              </button>
              <button className="w-10 h-10 bg-white flex items-center justify-center text-black hover:bg-white/90 transition-colors btn-cut-sm">
                <LinkedInIcon />
              </button>
              <button className="w-10 h-10 bg-white flex items-center justify-center text-black hover:bg-white/90 transition-colors btn-cut-sm">
                <FacebookIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
