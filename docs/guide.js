(function() {
  'use strict';
  function setLanguage(lang) {
    if (lang !== 'ru' && lang !== 'en') lang = 'en';
    document.documentElement.lang = lang;
    document.title = document.body.getAttribute('data-title-' + lang) + ' — GitLab Actions';
    document.querySelectorAll('[data-language]').forEach(function(el) { el.hidden = el.getAttribute('data-language') !== lang; });
    document.querySelectorAll('[data-switch]').forEach(function(el) { el.setAttribute('aria-pressed', String(el.getAttribute('data-switch') === lang)); });
    document.querySelectorAll('[data-en][data-ru]').forEach(function(el) { el.textContent = el.getAttribute('data-' + lang); });
    document.querySelectorAll('.brand, .nav-actions a, footer a[data-en]').forEach(function(el) { el.href = el.getAttribute('href').split('?')[0] + '?lang=' + lang; });
  }
  var query = new URLSearchParams(location.search).get('lang');
  var initial = query === 'ru' || query === 'en' ? query : (navigator.language || '').startsWith('ru') ? 'ru' : 'en';
  if (/^#(ru|en)-section-/.test(location.hash)) initial = location.hash.slice(1, 3);
  setLanguage(initial);
  document.querySelectorAll('[data-switch]').forEach(function(button) {
    button.addEventListener('click', function() {
      var lang = button.getAttribute('data-switch');
      setLanguage(lang);
      var url = new URL(location.href); url.searchParams.set('lang', lang);
      if (/^#(ru|en)-section-/.test(url.hash)) url.hash = '';
      history.replaceState(null, '', url);
    });
  });
})();
