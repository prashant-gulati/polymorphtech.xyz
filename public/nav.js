document.addEventListener("DOMContentLoaded", () => {
  const nav = document.createElement("div");
  nav.innerHTML = `
    <nav>
      <a class="nav-brand" href="/"><img src="/favicon.svg" alt="Polymorph Technologies" class="nav-logo"></a>
      <ul class="nav-links">
        <li><a href="/">Home</a></li>
        <li class="dropdown">
          <span>Products</span>
          <div class="dropdown-menu">
            <a class="dropdown-heading" href="/airadar">AI Radar</a>
            <a href="/airadar/blog">Blog</a>
            <a href="/airadar/docs">Docs</a>
            <a href="/airadar/tutorial">Tutorial</a>
            <a href="/airadar/faq">FAQ</a>
            <a href="/airadar/changelog">Changelog</a>
          </div>
        </li>
        <li><a href="/privacy.html">Privacy Policy</a></li>
        <li><a href="mailto:support@polymorphtech.xyz">Contact</a></li>
      </ul>
      <button class="hamburger" aria-label="Toggle menu" onclick="document.getElementById('mobileMenu').classList.toggle('open')">
        <span></span><span></span><span></span>
      </button>
    </nav>
    <div class="mobile-menu" id="mobileMenu">
      <a href="/">Home</a>
      <a href="/airadar" class="mobile-label">AI Radar</a>
      <a href="/airadar/blog" class="mobile-sub">Blog</a>
      <a href="/airadar/docs" class="mobile-sub">Docs</a>
      <a href="/airadar/tutorial" class="mobile-sub">Tutorial</a>
      <a href="/airadar/faq" class="mobile-sub">FAQ</a>
      <a href="/airadar/changelog" class="mobile-sub">Changelog</a>
      <a href="/privacy.html">Privacy Policy</a>
      <a href="mailto:support@polymorphtech.xyz">Contact</a>
    </div>
  `;

  const footer = document.createElement("footer");
  footer.innerHTML = `&copy; ${new Date().getFullYear()} Polymorph Technologies`;

  document.body.prepend(nav);
  document.body.append(footer);
});
