document.addEventListener("DOMContentLoaded", () => {
  const COMPANY_NAME = "Polymorph AI";

  const nav = document.createElement("div");
  nav.innerHTML = `
    <nav>
      <a class="nav-brand" href="/"><img src="/favicon.svg" alt="${COMPANY_NAME}" class="nav-logo"></a>
      <ul class="nav-links">
        <li class="dropdown">
          <span>Products</span>
          <div class="dropdown-menu">
            <a class="dropdown-heading" href="/airadar">AI Radar</a>
            <a href="/airadar/report">AI Readiness Report</a>
            <a href="/airadar/blog">Blog</a>
            <a href="/airadar/docs">Docs</a>
            <a href="/airadar/tutorial">Tutorial</a>
            <a href="/airadar/faq">FAQ</a>
            <a href="/airadar/changelog">Changelog</a>
          </div>
        </li>
        <li class="dropdown">
          <span style="display:flex;flex-direction:column;gap:3px;padding:4px 0;"><span style="display:block;width:18px;height:2px;background:#ddd;border-radius:1px;"></span><span style="display:block;width:18px;height:2px;background:#ddd;border-radius:1px;"></span><span style="display:block;width:18px;height:2px;background:#ddd;border-radius:1px;"></span></span>
          <div class="dropdown-menu">
            <a href="/privacy.html">Privacy Policy</a>
            <a href="mailto:support@polymorphtech.xyz">Contact</a>
          </div>
        </li>
      </ul>
      <button class="hamburger" aria-label="Toggle menu" onclick="document.getElementById('mobileMenu').classList.toggle('open')">
        <span></span><span></span><span></span>
      </button>
    </nav>
    <div class="mobile-menu" id="mobileMenu">
      <a href="/airadar" class="mobile-label">AI Radar</a>
      <a href="/airadar/report" class="mobile-sub">AI Readiness Report</a>
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
  footer.innerHTML = `
    <div class="footer-grid">
      <div class="footer-col">
        <h4>Products</h4>
        <a href="/airadar">AI Radar</a>
      </div>
      <div class="footer-col">
        <h4>Resources</h4>
        <a href="/airadar/blog">Blog</a>
        <a href="/airadar/docs">Docs</a>
        <a href="/airadar/tutorial">Tutorial</a>
        <a href="/airadar/faq">FAQ</a>
        <a href="/airadar/changelog">Changelog</a>
      </div>
      <div class="footer-col">
        <h4>Tools</h4>
        <a href="/airadar/report">AI Readiness Report</a>
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <a href="mailto:support@polymorphtech.xyz">Contact Us</a>
        <a href="/privacy.html">Privacy Policy</a>
      </div>
    </div>
    <div class="footer-bottom">&copy; ${new Date().getFullYear()} ${COMPANY_NAME}</div>
  `;

  document.body.prepend(nav);
  document.body.append(footer);

  // Microsoft Clarity
  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "clarity", "script", "w6j80sszkk");
});
