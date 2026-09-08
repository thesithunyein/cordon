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

function GitHubIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
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
            <a
              href="https://github.com/thesithunyein/cordon"
              target="_blank"
              rel="noreferrer"
              className="hidden md:block px-5 py-2.5 text-white text-sm hover:bg-white/10 btn-cut-border transition-colors"
            >
              <span>Source</span>
            </a>
            <a
              href="https://github.com/thesithunyein/cordon"
              target="_blank"
              rel="noreferrer"
              className="hidden md:block px-5 py-2.5 bg-white text-black text-sm hover:bg-white/90 btn-cut transition-colors"
            >
              GitHub
            </a>
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
              <p className="text-white/80 text-base leading-relaxed max-w-[240px]">
                Health factor drops.<br />
                Cordon simulates,<br />
                executes, verifies.
              </p>
              <div className="flex flex-col gap-2 mt-4">
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded-full border border-white/40" />
                  <div className="w-4 h-4 rounded-full border border-white/40" />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-white/70 text-xs">
                    Live on<br />Sepolia
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
                Your Aave position<br />
                defended automatically<br />
                by Cordon
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
              <p className="text-white text-sm leading-relaxed max-w-[280px] text-center md:text-left md:ml-auto">
                Cordon monitors your Aave V3 position on Sepolia, and when the
                health factor crosses your threshold it executes the protective
                transaction through KeeperHub — simulated first, audited always.
              </p>
            </div>

            {/* Col 2 */}
            <div
              className="flex flex-col items-center gap-8 md:gap-24 anim-stagger"
              style={{ animationDelay: '0.85s' }}
            >
              <span className="text-white text-2xl md:text-3xl font-medium">
                Powered by KeeperHub
              </span>
              <a
                href="https://github.com/thesithunyein/cordon"
                target="_blank"
                rel="noreferrer"
                className="w-full max-w-[280px] py-3.5 bg-white flex items-center justify-center gap-2 text-black hover:bg-white/90 transition-colors group btn-cut"
              >
                <span className="text-sm font-medium">Read the integration</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>

            {/* Col 3 */}
            <div
              className="flex items-center justify-center md:justify-end gap-3 anim-stagger"
              style={{ animationDelay: '1s' }}
            >
              <a
                href="https://github.com/thesithunyein/cordon"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 bg-white flex items-center justify-center text-black hover:bg-white/90 transition-colors btn-cut-sm"
              >
                <GitHubIcon />
              </a>
              <a
                href="https://x.com/"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 bg-white flex items-center justify-center text-black hover:bg-white/90 transition-colors btn-cut-sm"
              >
                <XIcon />
              </a>
              <a
                href="https://discord.gg/keeperhub"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 bg-white flex items-center justify-center text-black hover:bg-white/90 transition-colors btn-cut-sm"
              >
                <DiscordIcon />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}